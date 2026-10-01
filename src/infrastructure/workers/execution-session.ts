import type { AttemptServices } from '../../application/execution/services.js'
import { RunEvents, RunTracker } from '../../application/execution/services.js'
import type { Comparison } from '../../application/ports/comparison.js'
import type { Value } from '../../foundation/value.js'
import type { ExecutionCommand, ExecutionMessage } from './protocol.js'

/** compileを頼んだhostへの返信待ち。発番と突き合わせを1か所に閉じ込める。 */
export class CompileRequests {
  readonly #waiting = new Map<number, { resolve: (value: Value) => void; reject: (error: Value) => void }>()
  readonly #ask: (request: { id: number; name: string; args: Value[] }) => void
  #nextId = 0

  constructor(ask: (request: { id: number; name: string; args: Value[] }) => void) {
    this.#ask = ask
  }

  request(name: string, args: Value[]): Promise<Value> {
    return new Promise<Value>((resolve, reject) => {
      const id = this.#nextId++
      this.#waiting.set(id, { resolve, reject })
      this.#ask({ id, name, args })
    })
  }

  /** 覚えのない返信はprotocolの破れ。どう畳むかは入口が決めるため、ここでは伝えるだけにする。 */
  settle(reply: { id: number; result?: Value; error?: string }): boolean {
    const entry = this.#waiting.get(reply.id)
    if (!entry) return false
    this.#waiting.delete(reply.id)
    if (reply.error) entry.reject(new Error(reply.error))
    else entry.resolve(reply.result)
    return true
  }
}

/** hostから届くcommandの待ち行列。受信と取り出しのどちらが先行しても取りこぼさない。 */
export class CommandQueue {
  readonly #queued: ExecutionCommand[] = []
  #taker: ((command: ExecutionCommand) => void) | null = null

  push(command: ExecutionCommand): void {
    const taker = this.#taker
    if (taker) {
      this.#taker = null
      taker(command)
    } else this.#queued.push(command)
  }

  take(): Promise<ExecutionCommand> {
    const queued = this.#queued.shift()
    if (queued) return Promise.resolve(queued)
    return new Promise<ExecutionCommand>((resolve) => {
      this.#taker = resolve
    })
  }
}

/** 1つの実行workerが抱える可変状態の持ち主。workerの入口がこれを1つだけ作る。 */
export class ExecutionSession {
  readonly compiles: CompileRequests
  readonly commands = new CommandQueue()
  // 進捗の組み立てと結果ツリーはhost側が持つ。workerはtimeoutの報告に要るphaseとreasonだけを追う。
  readonly tracker = new RunTracker()
  readonly events: RunEvents
  readonly services: AttemptServices

  constructor(send: (message: ExecutionMessage) => void, comparison: Comparison) {
    this.compiles = new CompileRequests((request) => send({ type: 'compile', ...request }))
    this.events = new RunEvents({ onTimeout: () => send({ type: 'timeout', phase: this.tracker.phase ?? undefined }) })
    this.services = { comparison, tracker: this.tracker, events: this.events }
  }
}
