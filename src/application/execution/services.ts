import type { ResolvedCallAssertion } from '../../domain/assertion/runtime.js'
import { now } from './clock.js'

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
 * call期待の対象を、module runtimeが差し替えた関数へ繋ぎ直す手。
 * 差し替えを行うruntimeを持つ実行workerだけが繋ぎ直し、host側は対象をそのまま使う。
 * 繋ぎ替える相手は1回のrunで開いたruntimeに属するため、実行の持ち場が値として受け取る。
 */
export abstract class CallBinder {
  abstract bind(call: ResolvedCallAssertion): ResolvedCallAssertion
}
