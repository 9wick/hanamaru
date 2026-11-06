import type { CaseBlueprint } from '@hanamaru/blueprint/model'
import type { ExecutionNode } from '../../domain/execution/model.js'

export function indexExecutionNodes(nodes: ExecutionNode[]) {
  const entries = new Map<string, ExecutionNode>()
  const visit = (items: ExecutionNode[], parent: number[]): void => {
    items.forEach((node, index) => {
      const path = [...parent, index]
      entries.set(JSON.stringify(path), node)
      if (node.kind === 'group') visit(node.children, path)
    })
  }
  visit(nodes, [])
  return entries
}

export function allCases(nodes: ExecutionNode[]): CaseBlueprint[] {
  return nodes.flatMap((node) => (node.kind === 'test' ? node.bp.cases : allCases(node.children)))
}
