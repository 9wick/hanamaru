import { Injectable, inject } from '@zeltjs/core'
import type { MutableRunResult, Reason } from '../../domain/result/mutable.js'
import type { ExecutionPhase } from '../../domain/result/types.js'
import { required } from '../../foundation/value.js'
import { ProgressStore } from './progress.js'
import { RunContext } from './context.js'
import type { RunData } from './run-data.js'
import type { ActiveExecution, Deadline, Progress, RunEvent } from './state.js'
import { progressOf } from './state.js'

/**
 * 1runの実行状態と観測を管理する。進行・中断と、その時点の結果を同じ状態から読み出す。
 * イベントはデータとして通知し、利用者callbackやworker protocolへの変換は入口と通信サービスが担う。
 */
@Injectable()
export class RunLifecycle {
  readonly #results: ProgressStore
  readonly #context: RunContext
  readonly #observers = new Set<(event: RunEvent) => void>()
  readonly #subscriptions = new WeakMap<RunData, Set<(event: RunEvent) => void>>()

  constructor(results = inject(ProgressStore), context = inject(RunContext)) {
    this.#results = results
    this.#context = context
  }

  get reason(): Reason | null {
    return this.#context.data.reason
  }
  get active(): ActiveExecution | null {
    return this.#context.data.active
  }
  get phase(): ExecutionPhase | null {
    return this.#context.data.phase
  }

  /** 接続する側が購読の寿命を持つ。通知は状態更新後、同じ呼び出しの中で届く。 */
  observe(observer: (event: RunEvent) => void): () => void {
    let observers = this.#observers
    if (this.#context.scoped) {
      const data = this.#context.data
      const current = this.#subscriptions.get(data)
      observers = current ?? new Set()
      this.#subscriptions.set(data, observers)
    }
    observers.add(observer)
    return () => {
      observers.delete(observer)
    }
  }

  #emit(event: RunEvent): void {
    const observers = Array.from(this.#observers)
    const subscriptions = this.#subscriptions.get(this.#context.data)
    if (subscriptions) observers.push(...subscriptions)
    for (const observer of observers) observer(event)
  }

  abort(reason: Reason): void {
    this.#context.data.reason = reason
  }
  /** 中断はタイムアウトを上書きしない。 */
  interrupt(): void {
    if (this.reason !== 'timeout') this.#context.data.reason = 'interrupted'
  }
  /** 対象を開始し、attemptの中断時の姿と期限を同じ状態から知らせる。 */
  begin(active: ActiveExecution): void {
    this.#context.data.active = active
    this.#context.data.phase = active.kind === 'attempt' ? 'middleware' : null
    if (active.kind === 'attempt') this.announce(this.activeProgress('interrupted'))
    this.deadline({ kind: 'start', timeoutMs: active.timeoutMs, progress: this.activeProgress('timeout') })
  }
  markPhase(phase: ExecutionPhase): void {
    this.#context.data.phase = phase
  }
  end(): void {
    this.#context.data.active = null
    this.#context.data.phase = null
  }
  activeProgress(reason: Reason): Exclude<Progress, { kind: 'init' }> {
    return progressOf(required(this.active, 'no active execution for progress'), this.phase, reason)
  }

  /** 確定した進捗は、記録してから外へ知らせる。 */
  publish(progress: Progress): void {
    this.#results.apply(progress)
    this.announce(progress)
  }
  /** 実行前の中断時の姿など、まだ確定していない進捗は記録せず知らせる。 */
  announce(progress: Progress): void {
    this.#emit({ kind: 'progress', progress })
  }
  deadline(deadline: Deadline): void {
    this.#emit({ kind: 'deadline', deadline })
  }
  timedOut(): void {
    this.abort('timeout')
    this.#emit({ kind: 'timeout', phase: this.phase })
  }

  /** 打ち切り時の姿は複製。以後の実行や購読側の変更が互いの結果へ漏れない。 */
  capture(reason: Reason): MutableRunResult {
    return this.#results.capture(reason, this.active ? this.activeProgress(reason) : undefined)
  }
}
