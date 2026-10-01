import type { ResolvedCallAssertion } from '../../domain/assertion/runtime.js'
import { CallBinder } from '../../application/execution/services.js'
import type { RunningRuntime } from '../modules/runtime.js'

/** 実行workerの繋ぎ方。call期待の対象をmodule runtimeが差し替えた関数へ向け直す。 */
export class RuntimeCalls extends CallBinder {
  readonly #runtime: RunningRuntime

  constructor(runtime: RunningRuntime) {
    super()
    this.#runtime = runtime
  }

  bind(call: ResolvedCallAssertion): ResolvedCallAssertion {
    return this.#runtime.bindCall(call)
  }
}
