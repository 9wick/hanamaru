import type { MutableCaseResult, MutableNodeResult, Reason } from '../../domain/result/mutable.js'
import type { ExecutionPhase } from '../../domain/result/types.js'
import { required } from '../../foundation/value.js'
import type { Comparison } from '../ports/comparison.js'
import { now } from './clock.js'
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

function samePath(left: number[], right: number[]) {
  return left.length === right.length && left.every((part, index) => part === right[index])
}

function findNode(nodes: MutableNodeResult[], path: number[]): MutableNodeResult | null {
  for (const node of nodes) {
    if (samePath(node.path, path)) return node
    if (node.kind === 'group') {
      const found = findNode(
        node.children.map((entry) => entry.result),
        path,
      )
      if (found) return found
    }
  }
  return null
}

/** 実行の外側へ出す通知。受け取り手を持たない実行では何も起きない。 */
export class RunEvents {
  readonly #onProgress: ((progress: Progress) => void) | undefined
  readonly #onDeadline: ((deadline: Deadline) => void) | undefined
  readonly #onTimeout: (() => void) | undefined

  constructor(
    handlers: {
      onProgress?: (progress: Progress) => void
      onDeadline?: (deadline: Deadline) => void
      onTimeout?: () => void
    } = {},
  ) {
    this.#onProgress = handlers.onProgress
    this.#onDeadline = handlers.onDeadline
    this.#onTimeout = handlers.onTimeout
  }

  progress(progress: Progress): void {
    this.#onProgress?.(progress)
  }
  deadline(deadline: Deadline): void {
    this.#onDeadline?.(deadline)
  }
  timedOut(): void {
    this.#onTimeout?.()
  }
}

/** 実行中に変わる状態の持ち主。結果ツリーは実行ツリーと同じ形で事前構築したものを受け取る。 */
export class RunTracker {
  readonly #results: MutableNodeResult[]
  #reason: Reason | null
  #active: ActiveExecution | null = null
  #phase: ExecutionPhase | null = null

  constructor(reason: Reason | null = null, results: MutableNodeResult[] = []) {
    this.#reason = reason
    this.#results = results
  }

  get results(): MutableNodeResult[] {
    return this.#results
  }
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

  recordNode(value: MutableNodeResult): void {
    const path = value.path
    // 事前構築した結果ツリーに必ず同じ位置があるため、見つからないのは両者のずれを意味する
    if (path.length === 1) {
      const index = this.#results.findIndex((node) => samePath(node.path, path))
      if (index < 0) throw new Error(`result node not found: ${path.join('.')}`)
      this.#results[index] = value
      return
    }
    const parent = findNode(this.#results, path.slice(0, -1))
    const entry =
      parent?.kind === 'group' ? parent.children.find((child) => samePath(child.result.path, path)) : undefined
    if (!entry) throw new Error(`result node not found: ${path.join('.')}`)
    entry.result = value
  }

  recordCase(value: MutableCaseResult): void {
    const parent = findNode(this.#results, value.path.slice(0, -1))
    if (parent?.kind !== 'test') throw new Error(`result case parent not found: ${value.path.join('.')}`)
    const index = parent.cases.findIndex((item) => samePath(item.path, value.path))
    if (index < 0) throw new Error(`result case not found: ${value.path.join('.')}`)
    parent.cases[index] = value
  }
}

/** attemptとgroup middlewareの実行が使うサービス。データは引数で別に渡す。 */
export type AttemptServices = {
  readonly comparison: Comparison
  readonly tracker: RunTracker
  readonly events: RunEvents
}
