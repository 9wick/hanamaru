import { Injectable } from '@zeltjs/core'
import type {
  MutableCaseResult,
  MutableGroupResult,
  MutableNodeResult,
  MutableRunResult,
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

/**
 * 経路で引ける部分結果ツリーの唯一の持ち主。初期ツリーを一度索引化し、完了した結果を差分で反映する。
 * 実行中のプロセスも受け取り側のプロセスも、同じprogressを同じ手順で当てて同じ木に行き着く。
 */
@Injectable()
export class ProgressStore {
  result: MutableRunResult | null = null
  #index: ResultIndex = { cases: new Map(), groups: new Map(), failed: new Set() }

  apply(progress: Progress): void {
    if (progress.kind === 'init') {
      this.result = progress.result
      this.#index = indexResult(progress.result.tests)
      return
    }
    const result = this.result
    if (!result) throw new Error('progress received before initialization')
    if (progress.kind === 'case') {
      const slot = this.#index.cases.get(pathKey(progress.result.path))
      if (!slot) throw new Error('progress references an unknown case')
      slot.node.cases[slot.index] = progress.result
      this.#markFailure(progress.result.path, caseFailed(progress.result))
    } else {
      const node = this.#index.groups.get(pathKey(progress.path))
      if (!node) throw new Error('progress references an unknown group')
      node.middleware = progress.middleware
      this.#markFailure(progress.path, progress.middleware?.status === 'failed')
    }
    result.status = statusOf(this.#index.failed, result.reason)
  }

  #markFailure(path: number[], failed: boolean): void {
    if (failed) this.#index.failed.add(pathKey(path))
    else this.#index.failed.delete(pathKey(path))
  }
}
