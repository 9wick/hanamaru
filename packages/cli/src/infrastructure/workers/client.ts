import { Config, Injectable, inject } from '@zeltjs/core'
import type { MessagePort } from 'node:worker_threads'
import * as v from 'valibot'
import { CollectionModules } from '../../application/collection/module-session.js'
import { CollectionReporter } from '../../application/collection/reporting.js'
import type { RootReference } from '@hanamaru/execution/application/ports/root-reference'
import { CaseFailed } from '@hanamaru/execution/application/execution/faults'
import { RunLifecycle } from '@hanamaru/execution/application/execution/lifecycle'
import type {
  AttemptReply,
  ExecutionHandle,
  ExecutionServices,
  ExecutionSpec,
  GroupReply,
  PreparedExecution,
} from '@hanamaru/execution/application/ports/executor'
import { ExecutionLauncher } from '@hanamaru/execution/application/ports/executor'
import type { Fields, RuntimeCase } from '@hanamaru/blueprint/model'
import type { GroupNode, Plan, SuiteNode } from '@hanamaru/execution/domain/execution/model'
import { errorStack } from '../../application/collection/failure.js'
import { CollectionEnvironment } from './environment.js'
import { CollectionChannel } from './collection-channel.js'
import type { Value } from '../../application/collection/javascript.js'
import { required } from '../../application/collection/javascript.js'
import type { CommandInput, ReplyValue } from '@hanamaru/execution/infrastructure/workers/protocol'
import { PendingReplies } from '@hanamaru/execution/infrastructure/workers/requests'
import { executionMessageSchema } from '@hanamaru/execution/infrastructure/workers/execution-schemas'

/** 立ち上がりの合図。待つ側と知らせる側で持ち主が分かれるため、約束と口を一緒に作る。 */
function opening(): { settled: Promise<void>; open: () => void } {
  const captured: { open?: () => void } = {}
  const settled = new Promise<void>((resolve) => {
    captured.open = resolve
  })
  return { settled, open: required(captured.open) }
}

/**
 * 立ち上げた実行workerに繋がった、run 1回ぶんの持ち場。
 * 返信待ち・立ち上がりの約束・畳んだかどうかはこの1回に属し、
 * runの進み具合は開くときに受け取ったRunLifecycleへ渡す。
 */
@Injectable()
export class RunningExecution implements ExecutionHandle, PreparedExecution {
  readonly #requests = new PendingReplies<ReplyValue>()
  readonly #opening = opening()
  readonly #interrupt = () => this.#post({ type: 'interrupt' })
  /** workerが死んだ瞬間に待っている全部へ同じ失敗を渡すため、listenerへそのまま預けられる形で持つ。 */
  readonly #fail = (error: Value) => {
    this.#fatal ??= { error }
    // 収集中はまだ待ち手がいない。失敗を保持してstartで返し、未処理のPromise rejectionを作らない。
    this.#opening.open()
    this.#requests.abandon(error)
  }
  readonly #port: MessagePort
  readonly #stop: () => Promise<void>
  readonly #lifecycle: RunLifecycle
  #services: ExecutionServices | undefined
  #closing: Promise<void> | undefined
  #fatal: { error: Value } | null = null

  constructor(
    environment = inject(CollectionEnvironment),
    lifecycle = inject(RunLifecycle),
    channel = inject(CollectionChannel),
  ) {
    const port = environment.executionPort
    this.#port = port
    this.#lifecycle = lifecycle
    this.#stop = () => channel.closeExecution()
    port.on('messageerror', this.#fail)
    port.on('close', () => {
      if (!this.#closing) this.#fail(new Error('execution worker disconnected'))
    })
    port.on('message', (input) => this.#receive(input))
  }

  /** 計画が決まるまでworkerはテストを読まない。起動時の失敗もここで呼び出し側に返す。 */
  async start(spec: ExecutionSpec, services: ExecutionServices): Promise<ExecutionHandle> {
    if (this.#closing) throw new Error('execution worker is closed')
    if (this.#services) throw new Error('execution worker is already initialized')
    this.#throwFailure()
    this.#services = services
    services.onLoading('execution worker setup')
    services.signal.addEventListener('abort', this.#interrupt)
    if (services.signal.aborted) this.#interrupt()
    this.#post({ type: 'initialize', spec })
    await this.#opening.settled
    this.#throwFailure()
    return this
  }

  #throwFailure(): void {
    if (this.#fatal) throw this.#fatal.error
  }

  #post(message: Value): void {
    this.#port.postMessage(message)
  }

  #receive(input: unknown): void {
    if (this.#closing) return
    const parsed = v.safeParse(executionMessageSchema, input)
    if (!parsed.success) return this.#fail(new Error(`invalid execution message: ${v.summarize(parsed.issues)}`))
    const message = parsed.output
    if (message.type === 'error') return this.#fail(new Error(message.message))
    if (!this.#services) return this.#fail(new Error('execution message before initialization'))
    if (message.type === 'compile') {
      this.#services
        .invoke(message.name, message.args)
        .then(
          (result) => {
            if (!this.#closing) this.#post({ type: 'compiled', id: message.id, result })
          },
          (error) => {
            if (!this.#closing) this.#post({ type: 'compiled', id: message.id, error: errorStack(error) })
          },
        )
        .catch(this.#fail)
    } else if (message.type === 'ready') this.#opening.open()
    else if (message.type === 'loading') this.#services.onLoading(message.file)
    else if (message.type === 'reply') {
      if (!this.#requests.has(message.id)) return this.#fail(new Error('unexpected execution reply'))
      if ('reason' in message.value && message.value.reason) this.#lifecycle.abort(message.value.reason)
      this.#requests.settle(message.id, message.value)
    } else if (message.type === 'timeout') {
      if (message.phase) this.#lifecycle.markPhase(message.phase)
      this.#lifecycle.timedOut()
    } else if (message.type === 'group-stage') {
      if (message.stage === 'inside' || message.stage === 'end') this.#lifecycle.deadline({ kind: 'end' })
      else {
        this.#lifecycle.begin({
          kind: 'group',
          path: message.path,
          stage: message.stage,
          started: performance.now(),
          timeoutMs: message.timeoutMs,
        })
      }
    } else this.#fail(new Error('unknown execution message'))
  }

  #request(command: CommandInput): Promise<ReplyValue> {
    if (this.#fatal) return Promise.reject(this.#fatal.error)
    if (this.#closing) return Promise.reject(new Error('execution worker is closed'))
    return this.#requests.open((id) => this.#post({ ...command, id }))
  }

  /** 節はworkerが自分で読み直した計画から引くため、どのcaseかはpathで指す。 */
  async attempt(node: SuiteNode, _item: RuntimeCase, path: number[], number: number): Promise<AttemptReply> {
    const reply = await this.#request({ type: 'attempt', path, number, resourceFields: node.resourceFields })
    if (!('result' in reply)) throw new TypeError('unexpected attempt reply')
    return reply
  }

  /** 囲みの中のfieldsはworker側が持つため、子を辿る間の受け渡しは空で足りる。 */
  async group(node: GroupNode, path: number[], body: (fields: Fields) => Promise<void>): Promise<GroupReply> {
    const opened = await this.#request({ type: 'group-open', path, resourceFields: node.resourceFields })
    if ('result' in opened) throw new TypeError('unexpected group reply')
    if (!opened.entered) return opened
    let failed = true
    let bodyError,
      bodyFailed = false
    try {
      await body({})
      failed = false
    } catch (error) {
      if (!(error instanceof CaseFailed)) {
        bodyFailed = true
        bodyError = error
      }
    }
    const result = await this.#request({ type: 'group-close', path, failed })
    if (!('middleware' in result)) throw new TypeError('unexpected group close reply')
    if (bodyFailed) throw bodyError
    return result
  }

  close(): Promise<void> {
    if (!this.#closing) {
      this.#services?.signal.removeEventListener('abort', this.#interrupt)
      this.#fail(new Error('execution worker is closed'))
      this.#closing = this.#stop().finally(() => this.#port.close())
    }
    return this.#closing
  }
}

/**
 * CLIが先に起こした実行workerへの持ち場を開く。
 * 計画と外との繋ぎは収集後のstartで渡す。
 */
@Config()
export class WorkerExecutionLauncher extends ExecutionLauncher {
  readonly #execution: RunningExecution
  readonly #modules: CollectionModules
  readonly #reporter: CollectionReporter

  constructor(
    execution = inject(RunningExecution),
    modules = inject(CollectionModules),
    reporter = inject(CollectionReporter),
  ) {
    super()
    this.#execution = execution
    this.#modules = modules
    this.#reporter = reporter
  }

  open(): PreparedExecution {
    return this.#execution
  }

  async initialize(plan: Plan, roots: RootReference[], signal: AbortSignal, timeout: number): Promise<void> {
    await this.#execution.start(
      {
        roots,
        preparation: this.#modules.prepare(plan.blueprints),
        shape: JSON.stringify(this.#modules.describe(plan.allNodes)),
      },
      {
        invoke: (name, args) => this.#modules.invoke(name, args),
        signal,
        onLoading: (file) => this.#reporter.loading(file, timeout),
      },
    )
  }

  attempt(node: SuiteNode, item: RuntimeCase, path: number[], number: number): Promise<AttemptReply> {
    return this.#execution.attempt(node, item, path, number)
  }

  group(node: GroupNode, path: number[], body: (fields: Fields) => Promise<void>): Promise<GroupReply> {
    return this.#execution.group(node, path, body)
  }

  close(): Promise<void> {
    return this.#execution.close()
  }
}
