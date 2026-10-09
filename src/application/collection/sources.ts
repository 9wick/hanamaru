import type { ExecutionNode } from '../../domain/execution/model.js'
import type { MutableRunResult } from '../../domain/result/mutable.js'

/** どのファイルのどのprojectから来た根か。 */
export interface TestSource {
  file: string
  projects: string[]
}

/** 計画の節ごとの出どころ。収集した並びと計画が揃ってはじめて引けるため、計画が組み上がった時点で引く。 */
export function nodeSources(nodes: readonly ExecutionNode[], sources: readonly TestSource[]): readonly TestSource[] {
  return nodes.map((node) => sources[node.rootIndex])
}

/** 木の根へ出どころを付けた複製を返す。 */
export function withSources(result: MutableRunResult, byNode: readonly TestSource[]): MutableRunResult {
  return { ...result, tests: result.tests.map((node) => ({ ...node, source: byNode[node.path[0]] })) }
}
