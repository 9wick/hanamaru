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
} from '../../application/ports/executor.js'
import { Executor } from '../../application/ports/executor.js'
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
function opening(): { settled: Promise<void>; open: () => void; fail: (error: Value) => void } {
  const captured: { open?: () => void; fail?: (error: Value) => void } = {}
  const settled = new Promise<void>((resolve, reject) => {
    captured.open = resolve
    captured.fail = reject
  })
  return { settled, open: required(captured.open), fail: required(captured.fail) }
}

/**
 * 立ち上げた実行workerに繋がった、run 1回ぶんの持ち場。
 * 返信待ち・立ち上がりの約束・畳んだかどうかはこの1回に属し、
 * runの進み具合は開くときに受け取ったtrackerとeventsへ渡す。
 */
class RunningExecution implements ExecutionHandle {
  readonly #requests = new PendingReplies<ReplyValue>()
  readonly #opening = opening()
  readonly #interrupt = () => this.#post({ type: 'interrupt' })
  /** workerが死んだ瞬間に待っている全部へ同じ失敗を渡すため、listenerへそのまま預けられる形で持つ。 */
  readonly #fail = (error: Value) => {
    this.#fatal = error
    this.#opening.fail(error)
    this.#requests.abandon(error)
  }
  readonly #worker: Worker
  readonly #services: ExecutionServices
  readonly #tracker: RunTracker
  readonly #events: RunEvents
  #closing = false
  #fatal: Value = undefined

  constructor(worker: Worker, services: ExecutionServices, tracker: RunTracker, events: RunEvents) {
    this.#worker = worker
    this.#services = services
    this.#tracker = tracker
    this.#events = events
    services.signal.addEventListener('abort', this.#interrupt)
    if (services.signal.aborted) this.#interrupt()
    worker.on('error', this.#fail)
    worker.on('exit', (code) => {
      if (!this.#closing) this.#fail(new Error(`execution worker exited (${code})`))
    })
    worker.on('message', (input) => this.#receive(input))
  }

  /** workerが自分の持ち場を用意し終えるまで、commandは受け取ってもらえない。 */
  opened(): Promise<void> {
    return this.#opening.settled
  }

  #post(message: Value): void {
    this.#worker.postMessage(message)
  }

  #receive(input: unknown): void {
    const parsed = v.safeParse(executionMessageSchema, input)
    if (!parsed.success) return this.#fail(new Error(`invalid execution message: ${v.summarize(parsed.issues)}`))
    const message = parsed.output
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

  async close(): Promise<void> {
    this.#closing = true
    this.#services.signal.removeEventListener('abort', this.#interrupt)
    await this.#worker.terminate()
  }
}

/**
 * 実行workerを立ち上げて持ち場を開く。
 * 通知の受け取り手も走らせる計画も外との繋ぎも収集が終わるまで決まらないため、workerはstartで初めて起動する。
 */
@Config()
export class WorkerExecutionLauncher extends Executor {
  readonly #workerURL: URL
  readonly #tracker: RunTracker

  constructor(environment = inject(CollectionEnvironment), tracker = inject(RunTracker)) {
    super()
    this.#workerURL = environment.executionWorkerURL
    this.#tracker = tracker
  }

  /** 立ち上がりで落ちたworkerは残しておけない。畳んでから失敗を返す。 */
  async start(
    events: RunEvents,
    { roots, preparation, shape }: ExecutionSpec,
    services: ExecutionServices,
  ): Promise<ExecutionHandle> {
    services.onLoading('execution worker setup')
    const worker = new Worker(this.#workerURL, {
      workerData: { role: 'execution', roots, preparation, shape },
    })
    const execution = new RunningExecution(worker, services, this.#tracker, events)
    try {
      await execution.opened()
    } catch (error) {
      await execution.close()
      throw error
    }
    return execution
  }
}
