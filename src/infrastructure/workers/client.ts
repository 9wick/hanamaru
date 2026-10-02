import { Config, inject } from '@zeltjs/core'
import { Worker } from 'node:worker_threads'
import * as v from 'valibot'
import { CaseFailed } from '../../application/execution/faults.js'
import type { RunEvents } from '../../application/execution/services.js'
import { RunTracker } from '../../application/execution/services.js'
import type {
  AttemptReply,
  ExecutionHandle,
  ExecutionServices,
  ExecutionSpec,
  GroupReply,
  PreparedExecution,
} from '../../application/ports/executor.js'
import { ExecutionLauncher } from '../../application/ports/executor.js'
import type { Fields, RuntimeCase } from '../../domain/definition/runtime.js'
import type { GroupNode, SuiteNode } from '../../domain/execution/model.js'
import { errorStack } from '../../foundation/errors.js'
import { CollectionEnvironment } from './environment.js'
import type { Value } from '../../foundation/value.js'
import { required } from '../../foundation/value.js'
import type { CommandInput, ReplyValue } from './protocol.js'
import { PendingReplies } from './requests.js'
import { executionMessageSchema } from './schemas.js'

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
 * runの進み具合は開くときに受け取ったtrackerとeventsへ渡す。
 */
class RunningExecution implements PreparedExecution, ExecutionHandle {
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
  readonly #worker: Worker
  readonly #tracker: RunTracker
  #services: ExecutionServices | undefined
  #events: RunEvents | undefined
  #closing: Promise<void> | undefined
  #fatal: { error: Value } | null = null

  constructor(worker: Worker, tracker: RunTracker) {
    this.#worker = worker
    this.#tracker = tracker
    worker.on('error', this.#fail)
    worker.on('exit', (code) => {
      if (!this.#closing) this.#fail(new Error(`execution worker exited (${code})`))
    })
    worker.on('message', (input) => this.#receive(input))
  }

  /** 計画が決まるまでworkerはテストを読まない。起動時の失敗もここで呼び出し側に返す。 */
  async start(events: RunEvents, spec: ExecutionSpec, services: ExecutionServices): Promise<ExecutionHandle> {
    if (this.#closing) throw new Error('execution worker is closed')
    if (this.#services) throw new Error('execution worker is already initialized')
    this.#throwFailure()
    this.#services = services
    this.#events = events
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
    this.#worker.postMessage(message)
  }

  #receive(input: unknown): void {
    if (this.#closing) return
    const parsed = v.safeParse(executionMessageSchema, input)
    if (!parsed.success) return this.#fail(new Error(`invalid execution message: ${v.summarize(parsed.issues)}`))
    const message = parsed.output
    if (message.type === 'error') return this.#fail(new Error(message.message))
    if (!this.#services || !this.#events) return this.#fail(new Error('execution message before initialization'))
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
      if ('reason' in message.value && message.value.reason) this.#tracker.abort(message.value.reason)
      this.#requests.settle(message.id, message.value)
    } else if (message.type === 'timeout') {
      this.#tracker.abort('timeout')
      if (message.phase) this.#tracker.markPhase(message.phase)
      this.#events.timedOut()
    } else if (message.type === 'group-stage') {
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
    if (this.#fatal) return Promise.reject(this.#fatal.error)
    if (this.#closing) return Promise.reject(new Error('execution worker is closed'))
    return this.#requests.open((id) => this.#post({ ...command, id }))
  }

  /** 節はworkerが自分で読み直した計画から引くため、どのcaseかはpathで指す。 */
  async attempt(_node: SuiteNode, _item: RuntimeCase, path: number[], number: number): Promise<AttemptReply> {
    const reply = await this.#request({ type: 'attempt', path, number })
    if (!('result' in reply)) throw new TypeError('unexpected attempt reply')
    return reply
  }

  /** 囲みの中のfieldsはworker側が持つため、子を辿る間の受け渡しは空で足りる。 */
  async group(_node: GroupNode, path: number[], body: (fields: Fields) => Promise<void>): Promise<GroupReply> {
    const opened = await this.#request({ type: 'group-open', path })
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
      this.#closing = this.#worker.terminate().then(() => {})
    }
    return this.#closing
  }
}

/**
 * 実行workerを立ち上げて持ち場を開く。
 * 起動と依存読み込みは収集と並行して進める。計画と外との繋ぎは収集後のstartで渡す。
 */
@Config()
export class WorkerExecutionLauncher extends ExecutionLauncher {
  readonly #workerURL: URL
  readonly #tracker: RunTracker

  constructor(environment = inject(CollectionEnvironment), tracker = inject(RunTracker)) {
    super()
    this.#workerURL = environment.executionWorkerURL
    this.#tracker = tracker
  }

  open(): PreparedExecution {
    const worker = new Worker(this.#workerURL, {
      workerData: { role: 'execution' },
    })
    return new RunningExecution(worker, this.#tracker)
  }
}
