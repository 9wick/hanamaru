import { Injectable, inject } from '@zeltjs/core'
import { required } from '../../domain/execution/javascript.js'
import { RunContext } from './context.js'
import type { RunData } from './run-data.js'
import type {
  MutableCaseResult,
  MutableGroupResult,
  MutableNodeResult,
  MutableRunResult,
  Reason,
  MutableTestResult,
} from '../../domain/result/mutable.js'
import type { Progress } from './state.js'

/** 経路から部分結果の置き場所を引く索引。失敗している経路も同じ走査で数え上げる。 */
interface ResultIndex {
  cases: Map<string, { node: MutableTestResult; index: number }>
  groups: Map<string, MutableGroupResult>
  failed: Set<string>
}

function pathKey(path: number[]): string {
  return path.join('.')
}

function caseFailed(item: MutableCaseResult): boolean {
  return item.attempts.at(-1)?.status === 'failed'
}

function indexResult(tests: MutableNodeResult[]): ResultIndex {
  const index: ResultIndex = { cases: new Map(), groups: new Map(), failed: new Set() }
  const visit = (node: MutableNodeResult): void => {
    if (node.kind === 'test')
      node.cases.forEach((item, position) => {
        index.cases.set(pathKey(item.path), { node, index: position })
        if (caseFailed(item)) index.failed.add(pathKey(item.path))
      })
    else {
      index.groups.set(pathKey(node.path), node)
      if (node.middleware?.status === 'failed') index.failed.add(pathKey(node.path))
      node.children.forEach((entry) => visit(entry.result))
    }
  }
  tests.forEach(visit)
  return index
}

/** 途中結果の状態。打ち切った実行はpassedにならないため、失敗か中断のどちらかになる。 */
function statusOf(failed: ReadonlySet<string>, reason: MutableRunResult['reason']): 'failed' | 'cancelled' {
  return failed.size || reason === 'timeout' ? 'failed' : 'cancelled'
}

function indexRunResult(result: MutableRunResult): ResultIndex {
  const index = indexResult(result.tests)
  for (const resource of result.resources ?? [])
    if (resource.middleware.status === 'failed') index.failed.add(`resource:${resource.id}`)
  return index
}

/**
 * 経路で引ける部分結果ツリーの持ち主。初期ツリーを索引化し、完了した結果を差分で反映する。
 * 実行側と受信側が同じprogressから同じ木を作り、打ち切り時には独立した複製を返す。
 */
@Injectable()
export class ProgressStore {
  readonly #context: RunContext
  readonly #indexes = new WeakMap<RunData, ResultIndex>()

  constructor(context = inject(RunContext)) {
    this.#context = context
  }

  get result(): MutableRunResult | null {
    return this.#context.data.result
  }

  get #index(): ResultIndex {
    return required(this.#indexes.get(this.#context.data), 'progress index requested before initialization')
  }

  apply(progress: Progress): void {
    if (progress.kind === 'init') {
      this.#context.data.result = progress.result
      this.#indexes.set(this.#context.data, indexRunResult(progress.result))
      return
    }
    if (!this.result) throw new Error('progress received before initialization')
    this.#applyProgress(this.result, this.#index, progress)
  }

  capture(reason: Reason, active?: Exclude<Progress, { kind: 'init' }>): MutableRunResult {
    if (!this.result) throw new Error('snapshot requested before initialization')
    const snapshot: MutableRunResult = structuredClone({
      ...this.result,
      status: reason === 'timeout' ? 'failed' : this.result.status,
      reason,
    })
    if (active) this.#applyProgress(snapshot, indexRunResult(snapshot), structuredClone(active))
    return snapshot
  }
  #markFailure(index: ResultIndex, path: number[], failed: boolean): void {
    if (failed) index.failed.add(pathKey(path))
    else index.failed.delete(pathKey(path))
  }

  #applyProgress(result: MutableRunResult, index: ResultIndex, progress: Exclude<Progress, { kind: 'init' }>): void {
    if (progress.kind === 'resource') {
      result.resources ??= []
      const position = result.resources.findIndex((r) => r.id === progress.result.id)
      if (position < 0) result.resources.push(progress.result)
      else result.resources[position] = progress.result
      if (progress.result.middleware.status === 'failed') index.failed.add(`resource:${progress.result.id}`)
      else index.failed.delete(`resource:${progress.result.id}`)
    } else if (progress.kind === 'case') {
      const slot = index.cases.get(pathKey(progress.result.path))
      if (!slot) throw new Error('progress references an unknown case')
      slot.node.cases[slot.index] = progress.result
      this.#markFailure(index, progress.result.path, caseFailed(progress.result))
    } else {
      const node = index.groups.get(pathKey(progress.path))
      if (!node) throw new Error('progress references an unknown group')
      node.middleware = progress.middleware
      this.#markFailure(index, progress.path, progress.middleware?.status === 'failed')
    }
    result.status = statusOf(index.failed, result.reason)
  }
}
