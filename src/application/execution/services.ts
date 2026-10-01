import { Injectable, inject } from '@zeltjs/core'
import type { ResolvedCallAssertion } from '../../domain/assertion/runtime.js'
import type { MutableRunResult, Reason } from '../../domain/result/mutable.js'
import type { ExecutionPhase } from '../../domain/result/types.js'
import { required } from '../../foundation/value.js'
import { now } from './clock.js'
import { ProgressStore } from './progress.js'
import type { ActiveExecution, Deadline, Progress } from './state.js'
import { progressOf } from './state.js'

/**
 * 区間ごとの期限を測るタイマー。発火した区間と経過時間だけを持ち、何を打ち切るかは呼び出し側が決める。
 * 同期処理の間はタイマーが動けないため、発火していなくても経過時間で期限切れを判定できるようにする。
 */
export class StageTimer<S> {
  readonly #timeoutMs: number
  readonly #onExpire: (stage: S) => void
  #stage: S
  #startedAt: number | null
  #expired: S | null = null
  #handle: ReturnType<typeof setTimeout> | undefined

  constructor(timeoutMs: number, stage: S, onExpire: (stage: S) => void) {
    this.#timeoutMs = timeoutMs
    this.#onExpire = onExpire
    this.#stage = stage
    this.#startedAt = now()
    this.#schedule()
  }

  #schedule(): void {
    this.#handle = setTimeout(() => {
      this.#expired = this.#stage
      this.#onExpire(this.#stage)
    }, this.#timeoutMs)
  }

  get stage(): S {
    return this.#stage
  }

  /** 期限は据え置いたまま区間だけを進める。 */
  enter(stage: S): void {
    this.#stage = stage
  }

  /** 新しい区間として期限を測り直す。 */
  restart(stage: S): void {
    this.clear()
    this.#stage = stage
    this.#expired = null
    this.#startedAt = now()
    this.#schedule()
  }

  /** 期限の対象外の区間へ入る。発火済みの記録は残す。 */
  pause(stage: S): void {
    this.clear()
    this.#stage = stage
    this.#startedAt = null
  }

  /** タイマーを止める。期限切れの判定材料は残すため、止めたあとでも結果を読める。 */
  clear(): void {
    clearTimeout(this.#handle)
    this.#handle = undefined
  }

  /** 発火済みなら、発火した時点の区間。 */
  expired(): { stage: S } | null {
    return this.#expired === null ? null : { stage: this.#expired }
  }

  /** 発火済み、または計測中の区間が期限を過ぎているなら、その区間。 */
  overdue(): { stage: S } | null {
    if (this.#expired !== null) return { stage: this.#expired }
    if (this.#startedAt !== null && now() - this.#startedAt > this.#timeoutMs) return { stage: this.#stage }
    return null
  }
}

/**
 * 実行の外側で通知を受け取る手。タイムアウトだけは外へ出す打ち切り時の姿を必要とするため、
 * 内側の合図(RunEvents.timedOut)とは別に、組み立てた結果を受け取る。
 */
export type RunListeners = {
  readonly onProgress?: (progress: Progress) => void
  readonly onDeadline?: (deadline: Deadline) => void
  readonly onTimeout?: (result: MutableRunResult) => void
}

/**
 * 実行の外側へ出す通知の受け取り手。誰が受け取るかは1回のrunごとに決まるため、
 * 実行を始める側が値として組み立てて渡す。
 */
export abstract class RunEvents {
  abstract progress(progress: Progress): void
  abstract deadline(deadline: Deadline): void
  /** 打ち切り時に外へ出す姿は受け取り手が組み立てる。内側は合図だけを出す。 */
  abstract timedOut(): void
}

/** いま何を実行していて、なぜ打ち切るのかの持ち主。部分結果ツリーはProgressStoreが持つ。 */
@Injectable()
export class RunTracker {
  #reason: Reason | null = null
  #active: ActiveExecution | null = null
  #phase: ExecutionPhase | null = null

  get reason(): Reason | null {
    return this.#reason
  }
  get active(): ActiveExecution | null {
    return this.#active
  }
  get phase(): ExecutionPhase | null {
    return this.#phase
  }

  abort(reason: Reason): void {
    this.#reason = reason
  }
  /** 中断はタイムアウトを上書きしない。 */
  interrupt(): void {
    if (this.#reason !== 'timeout') this.#reason = 'interrupted'
  }
  begin(active: ActiveExecution): void {
    this.#active = active
    this.#phase = active.kind === 'attempt' ? 'middleware' : null
  }
  markPhase(phase: ExecutionPhase): void {
    this.#phase = phase
  }
  end(): void {
    this.#active = null
    this.#phase = null
  }
  activeProgress(reason: Reason): Progress {
    return progressOf(required(this.#active, 'no active execution for progress'), this.#phase, reason)
  }
}

/** 打ち切った実行の姿を、いまの部分結果ツリーから組み立てる手。 */
@Injectable()
export class RunSnapshot {
  readonly #results: ProgressStore
  readonly #tracker: RunTracker

  constructor(results = inject(ProgressStore), tracker = inject(RunTracker)) {
    this.#results = results
    this.#tracker = tracker
  }

  /** いまの部分結果を、与えられた理由で打ち切った結果として複製する。実行中の1件も反映する。 */
  capture(reason: Reason): MutableRunResult {
    const partial = required(this.#results.result)
    const snapshot = new ProgressStore()
    snapshot.apply({
      kind: 'init',
      result: structuredClone({ ...partial, status: reason === 'timeout' ? 'failed' : partial.status, reason }),
    })
    if (this.#tracker.active) snapshot.apply(this.#tracker.activeProgress(reason))
    return required(snapshot.result)
  }
}

/** 呼び出しごとに渡された受け取り手へ流す通知。ライブラリの入口が1回ぶんを組み立てる。 */
export class ListenerEvents extends RunEvents {
  readonly #listeners: RunListeners
  readonly #snapshot: RunSnapshot

  constructor(listeners: RunListeners, snapshot: RunSnapshot) {
    super()
    this.#listeners = listeners
    this.#snapshot = snapshot
  }

  progress(progress: Progress): void {
    this.#listeners.onProgress?.(progress)
  }
  deadline(deadline: Deadline): void {
    this.#listeners.onDeadline?.(deadline)
  }
  timedOut(): void {
    this.#listeners.onTimeout?.(this.#snapshot.capture('timeout'))
  }
}

/**
 * call期待の対象を、module runtimeが差し替えた関数へ繋ぎ直す手。
 * 差し替えを行うruntimeを持つ実行workerだけが繋ぎ直し、host側は対象をそのまま使う。
 * 繋ぎ替える相手は1回のrunで開いたruntimeに属するため、実行の持ち場が値として受け取る。
 */
export abstract class CallBinder {
  abstract bind(call: ResolvedCallAssertion): ResolvedCallAssertion
}
