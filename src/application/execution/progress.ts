import type {
  MutableGroupResult,
  MutableNodeResult,
  MutableRunResult,
  MutableTestResult,
} from '../../domain/result/mutable.js'
import type { Progress } from './state.js'

/** 初期ツリーを一度索引化し、完了済みの結果を差分で反映する。 */
export class ProgressStore {
  result: MutableRunResult | null = null
  private failed = new Set<string>()
  private cases = new Map<string, { node: MutableTestResult; index: number }>()
  private groups = new Map<string, MutableGroupResult>()

  private updateFailure(path: number[], failed: boolean) {
    if (failed) this.failed.add(path.join('.'))
    else this.failed.delete(path.join('.'))
    if (this.result) this.result.status = this.failed.size || this.result.reason === 'timeout' ? 'failed' : 'cancelled'
  }

  apply(progress: Progress): void {
    if (progress.kind === 'init') {
      this.result = progress.result
      this.failed.clear()
      this.cases.clear()
      this.groups.clear()
      const visit = (node: MutableNodeResult): void => {
        if (node.kind === 'test')
          node.cases.forEach((item, index) => {
            this.cases.set(item.path.join('.'), { node, index })
            if (item.attempts.at(-1)?.status === 'failed') this.failed.add(item.path.join('.'))
          })
        else {
          this.groups.set(node.path.join('.'), node)
          if (node.middleware?.status === 'failed') this.failed.add(node.path.join('.'))
          node.children.forEach((entry) => visit(entry.result))
        }
      }
      this.result.tests.forEach(visit)
      return
    }
    if (!this.result) throw new Error('progress received before initialization')
    if (progress.kind === 'case') {
      const entry = this.cases.get(progress.result.path.join('.'))
      if (!entry) throw new Error('progress references an unknown case')
      entry.node.cases[entry.index] = progress.result
      this.updateFailure(progress.result.path, progress.result.attempts.at(-1)?.status === 'failed')
    } else {
      const node = this.groups.get(progress.path.join('.'))
      if (!node) throw new Error('progress references an unknown group')
      node.middleware = progress.middleware
      this.updateFailure(progress.path, progress.middleware?.status === 'failed')
    }
  }
}
