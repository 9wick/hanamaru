import { Injectable, inject } from '@zeltjs/core'
import type { Resource } from '@hanamaru/blueprint/model'
import { checkedResources } from '@hanamaru/blueprint/model'
import { freezeFields, jsonFields, mergeResourceFields } from './resource-context.js'
import type { Fields, RuntimeMiddleware } from '@hanamaru/blueprint/model'
import { middlewareTag } from '@hanamaru/blueprint/model'
import type { MutableResourceResult } from '../../domain/result/mutable.js'
import { invoke, required, valueOf } from '../../domain/execution/javascript.js'
import { now } from './clock.js'
import { groupMiddlewareOutcome, withMiddleware } from './middleware.js'
import { RunLifecycle } from './lifecycle.js'
import { RunContext } from './context.js'
import type { RunData } from './run-data.js'

function deferred<T>() {
  const callbacks: { resolve?: (value: T) => void } = {}
  const promise = new Promise<T>((resolve) => {
    callbacks.resolve = resolve
  })
  return { promise, resolve: required(callbacks.resolve) }
}

interface OpenResource {
  resource: Resource
  fields: Fields | null
  release: () => void
  done: Promise<void>
  result: MutableResourceResult
}

/** 定義値をキーにした1runの資源台帳。実行workerごとの資源もbrainが保持しデータだけを渡す。 */
@Injectable()
export class RunResources {
  readonly #lifecycle: RunLifecycle
  readonly #context: RunContext
  readonly #ledgers = new WeakMap<RunData, Map<Resource, OpenResource>>()

  constructor(lifecycle = inject(RunLifecycle), context = inject(RunContext)) {
    this.#lifecycle = lifecycle
    this.#context = context
  }

  get results(): MutableResourceResult[] {
    return this.#context.data.resources
  }

  get #opened(): Map<Resource, OpenResource> {
    const data = this.#context.data
    let opened = this.#ledgers.get(data)
    if (!opened) {
      opened = new Map()
      this.#ledgers.set(data, opened)
    }
    return opened
  }

  async prepare(graph: readonly Resource[], signal?: AbortSignal): Promise<void> {
    for (const [id, resource] of graph.entries()) {
      const fields = this.fields(resource.require)
      if (this.#lifecycle.reason || fields === null) {
        const result: MutableResourceResult = {
          id,
          name: resource.name,
          scope: resource.scope,
          middleware: { status: 'not-run', reason: 'cancelled', durationMs: 0, failures: [], cleanup: 'complete' },
        }
        this.results.push(result)
        this.#lifecycle.publish({ kind: 'resource', result })
        continue
      }
      await this.#open(resource, id, fields, signal)
    }
  }

  fields(resources: readonly Resource[] = []): Fields | null {
    if (!resources.length) return {}
    const inputs: Fields[] = []
    for (const r of checkedResources(resources)) {
      const open = this.#opened.get(r)
      if (!open?.fields) return null
      inputs.push(open.fields)
    }
    return jsonFields(mergeResourceFields(inputs))
  }

  async #open(resource: Resource, id: number, fields: Fields, signal?: AbortSignal): Promise<void> {
    const ready = deferred<void>(),
      lifetime = deferred<void>()
    const started = now()
    const result: MutableResourceResult = {
      id,
      name: resource.name,
      scope: resource.scope,
      middleware: { status: 'cancelled', durationMs: 0, failures: [], cleanup: 'incomplete' },
    }
    this.results.push(result)
    const timeout = deferred<void>()
    const cancellation = new AbortController()
    let expired = false
    const open: OpenResource = {
      resource,
      fields: null,
      release: () => lifetime.resolve(),
      done: Promise.resolve(),
      result,
    }
    this.#opened.set(resource, open)
    const interrupt = () => {
      if (open.fields !== null || expired) return
      expired = true
      this.#lifecycle.interrupt()
      cancellation.abort()
      result.middleware = { status: 'cancelled', durationMs: now() - started, failures: [], cleanup: 'incomplete' }
      this.#lifecycle.publish({ kind: 'resource', result })
      this.#lifecycle.deadline({ kind: 'end' })
      ready.resolve()
      timeout.resolve()
    }
    signal?.addEventListener('abort', interrupt)
    const step: RuntimeMiddleware = {
      [middlewareTag]: true,
      kind: 'middleware',
      timeout: resource.timeout,
      run: (ctx: Fields, next: object) =>
        invoke(resource.setup, undefined, [
          ctx,
          (provided?: object) => {
            if (expired) throw new Error('resource setup finished after its scope was cancelled')
            return invoke(next, undefined, [jsonFields(provided)])
          },
        ]),
    }
    const execution = withMiddleware(
      step,
      freezeFields(fields),
      async (provided) => {
        open.fields = freezeFields(provided)
        this.#lifecycle.end()
        ready.resolve()
        await lifetime.promise
      },
      () => {
        if (expired) return
        expired = true
        this.#lifecycle.abort('timeout')
        const progress = this.#lifecycle.activeProgress('timeout')
        if (progress.kind !== 'resource') throw new Error('resource timeout without active resource')
        result.middleware = progress.result.middleware
        open.fields = null
        this.#lifecycle.publish(progress)
        this.#lifecycle.timedOut()
        ready.resolve()
        timeout.resolve()
      },
      (stage, timeoutMs) => {
        if (expired) return
        if (stage === 'inside' || stage === 'end') this.#lifecycle.deadline({ kind: 'end' })
        else {
          this.#lifecycle.begin({
            kind: 'resource',
            id,
            name: resource.name,
            scope: resource.scope,
            stage,
            started,
            timeoutMs,
          })
        }
      },
      cancellation.signal,
    )
      .then(
        () => {
          if (!expired)
            result.middleware = { status: 'passed', durationMs: now() - started, failures: [], cleanup: 'complete' }
        },
        (error) => {
          if (!expired) {
            const outcome = groupMiddlewareOutcome(valueOf(error), now() - started)
            result.middleware = outcome.middleware
            open.fields = null
            if (outcome.abort && this.#lifecycle.reason !== 'timeout') this.#lifecycle.abort(outcome.abort)
          }
        },
      )
      .then(() => {
        ready.resolve()
        if (!expired) this.#lifecycle.publish({ kind: 'resource', result })
        if (!expired) this.#lifecycle.end()
      })
    open.done = Promise.race([execution, timeout.promise])
    this.#lifecycle.publish({ kind: 'resource', result })
    if (signal?.aborted) interrupt()
    await ready.promise
    signal?.removeEventListener('abort', interrupt)
  }

  /** 実行側を閉じた後に呼ぶ。準備失敗時も、既に開いた依存を逆順で解放する。 */
  async close(): Promise<void> {
    for (const open of [...this.#opened.values()].reverse()) {
      open.release()
      await open.done
    }
  }
}
