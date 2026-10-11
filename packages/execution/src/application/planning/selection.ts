import { Injectable } from '@zeltjs/core'
import type { ExecutionNode } from '../../domain/execution/model.js'
import type { RunSettings } from '../execution/options.js'
import { allCases } from '../execution/plan.js'

export interface ExecutionSelectionResult {
  nodes: ExecutionNode[]
  only: boolean
}

function filterNodes(nodes: ExecutionNode[], text: string): ExecutionNode[] {
  return nodes.flatMap<ExecutionNode>((node, originalIndex) => {
    if (node.kind === 'test') {
      const cases = node.bp.cases.flatMap((item, index) =>
        item.name.includes(text) ? [{ ...item, originalIndex: index }] : [],
      )
      return cases.length ? [{ ...node, originalIndex, bp: { ...node.bp, cases } }] : []
    }
    const children = filterNodes(node.children, text)
    return children.length ? [{ ...node, originalIndex, children }] : []
  })
}

/** 全定義に対する禁止条件を確かめてから、今回扱う対象と集中実行の有無を決める。 */
@Injectable()
export class ExecutionSelection {
  select(allNodes: ExecutionNode[], settings: RunSettings): ExecutionSelectionResult {
    const unfilteredOnly = allCases(allNodes).some((item) => item.mode === 'only')
    if (unfilteredOnly && settings.forbidOnly) throw new TypeError('only is forbidden')
    const nodes = settings.filter === undefined ? allNodes : filterNodes(allNodes, settings.filter)
    if (!nodes.length) throw new TypeError('filter matched no cases')
    const only = allCases(nodes).some((item) => item.mode === 'only')
    return { nodes, only }
  }
}
