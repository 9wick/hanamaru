import { RunEvents, RunTracker } from '../../application/execution/services.js'
import type { ModuleInvoke } from '../../application/ports/module-loader.js'
import type { Value } from '../../foundation/value.js'
import type { ExecutionChannel } from './execution-channel.js'
import type { ExecutionCommand, ExecutionIncoming } from './protocol.js'

/**
 * compileを頼んだhostへの返信待ち。発番と突き合わせを1か所に閉じ込める。
 * module runtimeから見ると、収集workerが自分で立てるcompilerと同じ形の取り寄せ口になる。
 */
export class CompileRequests {
  readonly #waiting = new Map<number, { resolve: (value: Value) => void; reject: (error: Value) => void }>()
  readonly #channel: ExecutionChannel
  #nextId = 0

  constructor(channel: ExecutionChannel) {
    this.#channel = channel
  }

  /** 関数値として渡されるため、thisを抱えたまま持ち出せる形にする。 */
  readonly invoke: ModuleInvoke = (name, args) =>
    new Promise<Value>((resolve, reject) => {
      const id = this.#nextId++
      this.#waiting.set(id, { resolve, reject })
      this.#channel.compile({ id, name, args })
    })

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

  constructor(channel: ExecutionChannel) {
    this.compiles = new CompileRequests(channel)
    this.events = new RunEvents({ onTimeout: () => channel.timedOut(this.tracker.phase ?? undefined) })
  }

  /**
   * 親から届いた1件を行き先へ振り分ける。覚えのないcompile返信だけはprotocolの破れで、
   * どう畳むかは入口が決めるため、見分けた結果だけを返す。
   */
  receive(message: ExecutionIncoming): boolean {
    if (message.type === 'compiled') return this.compiles.settle(message)
    if (message.type === 'interrupt') {
      this.tracker.interrupt()
      return true
    }
    this.commands.push(message)
    return true
  }
}
