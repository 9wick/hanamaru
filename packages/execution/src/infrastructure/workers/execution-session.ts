import { Config, Injectable, inject } from '@zeltjs/core'
import { RunLifecycle } from '../../application/execution/lifecycle.js'
import { ModuleTransport } from '@hanamaru/module-runtime/application/ports/module-loader'
import type { Value } from '../../domain/execution/javascript.js'
import { ExecutionChannel } from './execution-channel.js'
import type { ExecutionCommand, ExecutionIncoming } from './protocol.js'
import { PendingReplies } from './requests.js'

/**
 * compileを収集workerのportへ頼む取り寄せ口。発番と突き合わせを1か所に閉じ込める。
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

/** 収集workerから届いた1件を行き先へ振り分ける受け口。 */
@Injectable()
export class ExecutionSession {
  readonly #compiles: CompileRequests
  readonly #commands: CommandQueue
  readonly #lifecycle: RunLifecycle

  constructor(compiles = inject(CompileRequests), commands = inject(CommandQueue), lifecycle = inject(RunLifecycle)) {
    this.#compiles = compiles
    this.#commands = commands
    this.#lifecycle = lifecycle
  }

  /**
   * 覚えのないcompile返信だけはprotocolの破れで、
   * どう畳むかは入口が決めるため、見分けた結果だけを返す。
   */
  receive(message: Exclude<ExecutionIncoming, { type: 'initialize' }>): boolean {
    if (message.type === 'compiled') return this.#compiles.settle(message)
    if (message.type === 'interrupt') {
      this.#lifecycle.interrupt()
      return true
    }
    this.#commands.push(message)
    return true
  }
}
