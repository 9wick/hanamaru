import { Worker } from 'node:worker_threads'
import * as v from 'valibot'
import type { RunEvents, RunTracker } from '../../application/execution/services.js'
import type { ExecutionServices, ExecutionSpec } from '../../application/ports/collection-host.js'
import type { AttemptReply, Executor, GroupReply } from '../../application/ports/executor.js'
import type { ModuleInvoke } from '../../application/ports/module-loader.js'
import { errorStack } from '../../foundation/errors.js'
import type { Value } from '../../foundation/value.js'
import { required } from '../../foundation/value.js'
import type { CommandInput, ReplyValue } from './protocol.js'
import { executionMessageSchema } from './schemas.js'

/** 返信待ちのcommand。idで突き合わせ、致命的な失敗では待っている全部を一度に諦めさせる。 */
export class RequestTable {
  readonly #waiting = new Map<number, { resolve: (value: ReplyValue) => void; reject: (error: Value) => void }>()
  #nextId = 0

  open(post: (id: number) => void): Promise<ReplyValue> {
    const id = this.#nextId++
    return new Promise<ReplyValue>((resolve, reject) => {
      this.#waiting.set(id, { resolve, reject })
      post(id)
    })
  }

  /** 覚えのない返信はprotocolの破れ。どう畳むかは持ち主が決めるため、見分けるだけにする。 */
  has(id: number): boolean {
    return this.#waiting.has(id)
  }

  settle(id: number, value: ReplyValue): void {
    const entry = this.#waiting.get(id)
    if (!entry) throw new TypeError('no request is waiting for this reply')
    this.#waiting.delete(id)
    entry.resolve(value)
  }

  abandon(error: Value): void {
    for (const entry of this.#waiting.values()) entry.reject(error)
    this.#waiting.clear()
  }
}

/**
 * 実行workerをExecutorとして扱う。worker・返信待ち・立ち上がりの約束・畳んだかどうかを自分で持ち、
 * runの進み具合はattachで預かったtrackerとeventsへ渡す。
 */
class WorkerExecutor {
  readonly #requests = new RequestTable()
  readonly #interrupt = () => this.#worker.postMessage({ type: 'interrupt' })
  /** workerが死んだ瞬間に待っている全部へ同じ失敗を渡すため、listenerへそのまま預けられる形で持つ。 */
  readonly #fail = (error: Value) => {
    this.#fatal = error
    required(this.#failReady)(error)
    this.#requests.abandon(error)
  }
  readonly #worker: Worker
  readonly #signal: AbortSignal | undefined
  readonly #onLoading: (file: string) => void
  readonly #invoke: ModuleInvoke
  readonly #ready: Promise<void>
  #openReady: (() => void) | null = null
  #failReady: ((error: Value) => void) | null = null
  #tracker: RunTracker | null = null
  #events: RunEvents | null = null
  #closing = false
  #fatal: Value = undefined

  constructor(
    workerURL: URL,
    { roots, preparation, shape }: ExecutionSpec,
    { signal, onLoading, invoke }: ExecutionServices,
  ) {
    this.#signal = signal
    this.#onLoading = onLoading
    this.#invoke = invoke
    this.#ready = new Promise<void>((resolve, reject) => {
      this.#openReady = resolve
      this.#failReady = reject
    })
    this.#worker = new Worker(workerURL, {
      workerData: { role: 'execution', roots, preparation, shape },
    })
    signal?.addEventListener('abort', this.#interrupt)
    if (signal?.aborted) this.#interrupt()
    this.#worker.on('error', this.#fail)
    this.#worker.on('exit', (code) => {
      if (!this.#closing) this.#fail(new Error(`execution worker exited (${code})`))
    })
    this.#worker.on('message', (input) => this.#receive(input))
  }

  /** 立ち上がりで落ちたworkerは残しておけない。畳んでから失敗を返す。 */
  async start(): Promise<void> {
    try {
      await this.#ready
    } catch (error) {
      await this.close()
      throw error
    }
  }

  #receive(input: unknown): void {
    const parsed = v.safeParse(executionMessageSchema, input)
    if (!parsed.success) return this.#fail(new Error(`invalid execution message: ${v.summarize(parsed.issues)}`))
    const message = parsed.output
    if (message.type === 'compile') {
      this.#invoke(message.name, message.args)
        .then(
          (result) => {
            if (!this.#closing) this.#worker.postMessage({ type: 'compiled', id: message.id, result })
          },
          (error) => {
            if (!this.#closing) this.#worker.postMessage({ type: 'compiled', id: message.id, error: errorStack(error) })
          },
        )
        .catch(this.#fail)
    } else if (message.type === 'ready') required(this.#openReady)()
    else if (message.type === 'loading') this.#onLoading(message.file)
    else if (message.type === 'error') this.#fail(new Error(message.message))
    else if (message.type === 'reply') {
      if (!this.#requests.has(message.id)) return this.#fail(new Error('unexpected execution reply'))
      if ('reason' in message.value && message.value.reason) this.#tracker?.abort(message.value.reason)
      this.#requests.settle(message.id, message.value)
    } else if (message.type === 'timeout') {
      if (!this.#tracker || !this.#events) return this.#fail(new Error('execution state is not attached'))
      this.#tracker.abort('timeout')
      if (message.phase) this.#tracker.markPhase(message.phase)
      this.#events.timedOut()
    } else if (message.type === 'group-stage') {
      if (!this.#tracker || !this.#events) return this.#fail(new Error('execution state is not attached'))
      if (message.stage === 'inside' || message.stage === 'end') this.#events.deadline({ kind: 'end' })
      else {
        this.#tracker.begin({
          kind: 'group',
          path: message.path,
          stage: message.stage,
          started: performance.now(),
          timeoutMs: message.timeoutMs,
        })
        this.#events.deadline({
          kind: 'start',
          timeoutMs: message.timeoutMs,
          progress: this.#tracker.activeProgress('timeout'),
        })
      }
    } else this.#fail(new Error('unknown execution message'))
  }

  #request(command: CommandInput): Promise<ReplyValue> {
    if (this.#fatal) return Promise.reject(this.#fatal)
    if (this.#closing) return Promise.reject(new Error('execution worker is closed'))
    return this.#requests.open((id) => this.#worker.postMessage({ ...command, id }))
  }

  attach(tracker: RunTracker, events: RunEvents): void {
    this.#tracker = tracker
    this.#events = events
  }

  async attempt(path: number[], number: number): Promise<AttemptReply> {
    const reply = await this.#request({ type: 'attempt', path, number })
    if (!('result' in reply)) throw new TypeError('unexpected attempt reply')
    return reply
  }

  async group(path: number[], body: () => Promise<boolean>): Promise<GroupReply> {
    const opened = await this.#request({ type: 'group-open', path })
    if ('result' in opened) throw new TypeError('unexpected group reply')
    if (!opened.entered) return opened
    let failed = true
    let bodyError,
      bodyFailed = false
    try {
      failed = await body()
    } catch (error) {
      bodyFailed = true
      bodyError = error
    }
    const result = await this.#request({ type: 'group-close', path, failed })
    if (!('middleware' in result)) throw new TypeError('unexpected group close reply')
    if (bodyFailed) throw bodyError
    return result
  }

  async close(): Promise<void> {
    this.#closing = true
    this.#signal?.removeEventListener('abort', this.#interrupt)
    await this.#worker.terminate()
  }
}

export async function openExecution(
  workerURL: URL,
  spec: ExecutionSpec,
  services: ExecutionServices,
): Promise<Executor> {
  services.onLoading('execution worker setup')
  const executor = new WorkerExecutor(workerURL, spec, services)
  await executor.start()
  return executor
}
