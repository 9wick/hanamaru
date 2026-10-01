import { Config, inject } from '@zeltjs/core'
import { Worker } from 'node:worker_threads'
import * as v from 'valibot'
import { RunEvents, RunTracker } from '../../application/execution/services.js'
import type { AttemptReply, ExecutionServices, ExecutionSpec, GroupReply } from '../../application/ports/executor.js'
import { ExecutionPlace, Executor } from '../../application/ports/executor.js'
import { errorStack } from '../../foundation/errors.js'
import { CollectionEnvironment } from './environment.js'
import type { Value } from '../../foundation/value.js'
import { required } from '../../foundation/value.js'
import type { CommandInput, ReplyValue } from './protocol.js'
import { PendingReplies } from './requests.js'
import { executionMessageSchema } from './schemas.js'

/**
 * 実行workerをExecutorとして扱う。返信待ち・立ち上がりの約束・畳んだかどうかを自分で持ち、
 * runの進み具合は組み立て時に受け取ったtrackerとeventsへ渡す。
 * 走らせる計画も外との繋ぎも収集が終わるまで決まらないため、workerはstartで初めて起動する。
 */
@Config()
export class WorkerExecutor extends Executor {
  readonly #requests = new PendingReplies<ReplyValue>()
  readonly #interrupt = () => this.#post({ type: 'interrupt' })
  /** workerが死んだ瞬間に待っている全部へ同じ失敗を渡すため、listenerへそのまま預けられる形で持つ。 */
  readonly #fail = (error: Value) => {
    this.#fatal = error
    required(this.#failReady)(error)
    this.#requests.abandon(error)
  }
  readonly #workerURL: URL
  readonly #tracker: RunTracker
  readonly #events: RunEvents
  /** 外との繋ぎはstartで決まる。立ち上げる前のこの口は、まだどのrunにも属していない。 */
  #services: ExecutionServices | null = null
  #worker: Worker | null = null
  #openReady: (() => void) | null = null
  #failReady: ((error: Value) => void) | null = null
  #closing = false
  #fatal: Value = undefined

  constructor(environment = inject(CollectionEnvironment), tracker = inject(RunTracker), events = inject(RunEvents)) {
    super()
    this.#workerURL = environment.executionWorkerURL
    this.#tracker = tracker
    this.#events = events
  }

  #post(message: Value): void {
    required(this.#worker, 'execution worker is not started').postMessage(message)
  }

  /** 立ち上がりで落ちたworkerは残しておけない。畳んでから失敗を返す。 */
  async start({ roots, preparation, shape }: ExecutionSpec, services: ExecutionServices): Promise<void> {
    this.#services = services
    services.onLoading('execution worker setup')
    const ready = new Promise<void>((resolve, reject) => {
      this.#openReady = resolve
      this.#failReady = reject
    })
    const worker = new Worker(this.#workerURL, {
      workerData: { role: 'execution', roots, preparation, shape },
    })
    this.#worker = worker
    services.signal.addEventListener('abort', this.#interrupt)
    if (services.signal.aborted) this.#interrupt()
    worker.on('error', this.#fail)
    worker.on('exit', (code) => {
      if (!this.#closing) this.#fail(new Error(`execution worker exited (${code})`))
    })
    worker.on('message', (input) => this.#receive(input))
    try {
      await ready
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
      required(this.#services)
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
    } else if (message.type === 'ready') required(this.#openReady)()
    else if (message.type === 'loading') required(this.#services).onLoading(message.file)
    else if (message.type === 'error') this.#fail(new Error(message.message))
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
    if (this.#fatal) return Promise.reject(this.#fatal)
    if (this.#closing) return Promise.reject(new Error('execution worker is closed'))
    return this.#requests.open((id) => this.#post({ ...command, id }))
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
    this.#services?.signal.removeEventListener('abort', this.#interrupt)
    await this.#worker?.terminate()
  }
}

/** 収集workerから見た実行場所。計画を辿る間のattemptとgroupは実行workerへ渡す。 */
@Config()
export class WorkerExecutionPlace extends ExecutionPlace {
  readonly executor: Executor

  constructor(executor = inject(Executor)) {
    super()
    this.executor = executor
  }
}
