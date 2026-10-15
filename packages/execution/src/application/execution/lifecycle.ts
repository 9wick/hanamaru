import { Injectable } from '@zeltjs/core'
import type { ExecutionPhase, Reason } from '@hanamaru/execution-protocol/data'

/** worker内の試行のphaseと中断理由。計画の進行と全体結果はrunnerが所有する。 */
@Injectable()
export class ExecutionLifecycle {
  #reason: Reason | null = null
  #phase: ExecutionPhase | null = null
  readonly #observers = new Set<(event: { kind: 'timeout'; phase: ExecutionPhase | null }) => void>()
  reset(): void {
    this.#reason = null
    this.#phase = null
  }
  get reason(): Reason | null {
    return this.#reason
  }
  get phase(): ExecutionPhase | null {
    return this.#phase
  }
  observe(observer: (event: { kind: 'timeout'; phase: ExecutionPhase | null }) => void): () => void {
    this.#observers.add(observer)
    return () => {
      this.#observers.delete(observer)
    }
  }
  abort(reason: Reason): void {
    this.#reason = reason
  }
  interrupt(): void {
    if (this.#reason !== 'timeout') this.#reason = 'interrupted'
  }
  markPhase(phase: ExecutionPhase): void {
    this.#phase = phase
  }
  end(): void {
    this.#phase = null
  }
  timedOut(): void {
    this.#reason = 'timeout'
    for (const observer of this.#observers) observer({ kind: 'timeout', phase: this.#phase })
  }
}
