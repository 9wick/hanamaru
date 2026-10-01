import { Config, Injectable, inject } from '@zeltjs/core'
import { RunEvents, RunTracker } from '../../application/execution/services.js'
import type { Deadline, Progress } from '../../application/execution/state.js'
import { ModuleTransport } from '../../application/ports/module-loader.js'
import type { Value } from '../../foundation/value.js'
import { ExecutionChannel } from './execution-channel.js'
import type { ExecutionCommand, ExecutionIncoming } from './protocol.js'
import { PendingReplies } from './requests.js'

/**
 * compileを親のportへ頼む取り寄せ口。発番と突き合わせを1か所に閉じ込める。
 * module runtimeから見ると、収集workerが自分で立てるcompilerと同じ形の取り寄せ口になる。
 */
@Config()
export class CompileRequests extends ModuleTransport {
  readonly #pending = new PendingReplies<Value>()
  readonly #channel: ExecutionChannel

  constructor(channel = inject(ExecutionChannel)) {
    super()
    this.#channel = channel
  }

  invoke(name: string, args: Value[]): Promise<Value> {
    return this.#pending.open((id) => this.#channel.compile({ id, name, args }))
  }

  /** 覚えのない返信はprotocolの破れ。どう畳むかは入口が決めるため、ここでは伝えるだけにする。 */
  settle(reply: { id: number; result?: Value; error?: string }): boolean {
    return reply.error
      ? this.#pending.fail(reply.id, new Error(reply.error))
      : this.#pending.settle(reply.id, reply.result)
  }
}

/**
 * 実行workerが外へ出せる通知。進捗の組み立てと結果ツリーはhost側が持つため、
 * workerが知らせるのはtimeoutと、そのとき見ていたphaseだけになる。
 */
@Config()
export class ChannelRunEvents extends RunEvents {
  readonly #channel: ExecutionChannel
  readonly #tracker: RunTracker

  constructor(channel = inject(ExecutionChannel), tracker = inject(RunTracker)) {
    super()
    this.#channel = channel
    this.#tracker = tracker
  }

  progress(_progress: Progress): void {}
  deadline(_deadline: Deadline): void {}

  timedOut(): void {
    this.#channel.timedOut(this.#tracker.phase ?? undefined)
  }
}

/** hostから届くcommandの待ち行列。受信と取り出しのどちらが先行しても取りこぼさない。 */
@Injectable()
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

/** 親から届いた1件を行き先へ振り分ける受け口。 */
@Injectable()
export class ExecutionSession {
  readonly #compiles: CompileRequests
  readonly #commands: CommandQueue
  readonly #tracker: RunTracker

  constructor(compiles = inject(CompileRequests), commands = inject(CommandQueue), tracker = inject(RunTracker)) {
    this.#compiles = compiles
    this.#commands = commands
    this.#tracker = tracker
  }

  /**
   * 覚えのないcompile返信だけはprotocolの破れで、
   * どう畳むかは入口が決めるため、見分けた結果だけを返す。
   */
  receive(message: ExecutionIncoming): boolean {
    if (message.type === 'compiled') return this.#compiles.settle(message)
    if (message.type === 'interrupt') {
      this.#tracker.interrupt()
      return true
    }
    this.#commands.push(message)
    return true
  }
}
