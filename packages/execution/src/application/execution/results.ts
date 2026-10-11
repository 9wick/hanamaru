import type { CaseBlueprint } from '@hanamaru/blueprint/model'
import type { ResolvedExecutionConfig } from '../../domain/execution/config.js'
import { configWith } from '../../domain/execution/config.js'
import type { ExecutionNode } from '../../domain/execution/model.js'
import { diagnostic } from '../../domain/result/diagnostic.js'
import type {
  CaseResultBase,
  MutableCaseResult,
  MutableGroupMiddleware,
  MutableNodeResult,
} from '../../domain/result/mutable.js'
import { required } from '../../domain/execution/javascript.js'

/** 実行しない理由。onlyがあるときは、onlyでないcaseも落ちる。 */
export function executableMode(item: CaseBlueprint, only: boolean): 'todo' | 'skipped' | null {
  if (item.mode === 'todo') return 'todo'
  if (item.mode === 'skip' || (only && item.mode !== 'only')) return 'skipped'
  return null
}

/** 実行してもしなくても変わらないcaseの素性。実行結果はここに足していく。 */
export function caseBase(
  config: ResolvedExecutionConfig,
  item: CaseBlueprint,
  index: number,
  path: number[],
): CaseResultBase {
  return {
    name: item.name,
    origin: item.origin,
    path: [...path, item.originalIndex ?? index],
    row: item.row ? { index: item.row.index, value: diagnostic(item.row.value) } : null,
    config: configWith(config, item.config),
  }
}

export function notRunCase(base: CaseResultBase, notRun: 'todo' | 'skipped' | 'cancelled'): MutableCaseResult {
  return { ...base, durationMs: 0, attempts: [], notRun }
}

export function notRunMiddleware(reason: 'no-runnable-cases' | 'cancelled'): MutableGroupMiddleware {
  return { status: 'not-run', reason, durationMs: 0, failures: [], cleanup: 'complete' }
}

/** 実行しなかった部分木。実行前の初期ツリーと、打ち切ったあとの残りの両方がこの形になる。 */
export function cancelledTree(node: ExecutionNode, path: number[], only: boolean): MutableNodeResult {
  if (node.kind === 'test')
    return {
      kind: 'test',
      name: node.bp.name,
      path,
      cases: node.bp.cases.map((item, index) =>
        notRunCase(caseBase(node.config, item, index, path), executableMode(item, only) ?? 'cancelled'),
      ),
    }
  return {
    kind: 'group',
    name: node.bp.name,
    origin: node.bp.origin,
    middleware: node.bp.middleware ? notRunMiddleware('cancelled') : null,
    path,
    children: node.children.map((child, index) => ({
      origin: required(child.entryOrigin),
      result: cancelledTree(child, [...path, child.originalIndex ?? index], only),
    })),
  }
}

/** 結果ツリーに失敗があるか。flakyを失敗とみなすかは呼び出し側が決める。 */
export function resultFailed(nodes: MutableNodeResult[], failOnFlaky = false): boolean {
  for (const node of nodes) {
    if (node.kind === 'group') {
      if (
        node.middleware?.status === 'failed' ||
        resultFailed(
          node.children.map((x) => x.result),
          failOnFlaky,
        )
      )
        return true
    } else
      for (const item of node.cases) {
        const last = item.attempts.at(-1)
        if (last?.status === 'failed' || (failOnFlaky && last?.status === 'passed' && item.attempts.length > 1))
          return true
      }
  }
  return false
}
