import type { RootReference } from '@hanamaru/execution-protocol/data'
import type { TargetCatalogue, TargetSelection } from '../../domain/execution/targets.js'
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
        item.name.includes(text) ? [{ ...item, originalIndex: item.originalIndex ?? index }] : [],
      )
      return cases.length
        ? [{ ...node, originalIndex: node.originalIndex ?? originalIndex, bp: { ...node.bp, cases } }]
        : []
    }
    const children = filterNodes(node.children, text)
    return children.length ? [{ ...node, originalIndex: node.originalIndex ?? originalIndex, children }] : []
  })
}

function catalogueOf(nodes: ExecutionNode[], roots: readonly RootReference[]): TargetCatalogue {
  const definitions = roots.map((root, rootIndex) => ({
    id: 'd:' + encodeURIComponent(root.file) + ':' + root.index,
    file: root.file,
    origin: root.origin,
    rootIndex,
    name: nodes
      .filter((node) => node.rootIndex === rootIndex)
      .map((node) => node.bp.name ?? '(group)')
      .join(' / '),
  }))
  const cases: TargetCatalogue['cases'][number][] = []
  const offsets = new Map<number, number>()
  const visit = (node: ExecutionNode, path: number[], relative: number[]) => {
    const definition = definitions[node.rootIndex]
    if (!definition) throw new TypeError('execution roots do not match definitions')
    if (node.kind === 'group')
      node.children.forEach((child, index) => visit(child, [...path, index], [...relative, index]))
    else
      node.bp.cases.forEach((item, caseIndex) =>
        cases.push({
          id:
            'c:' +
            encodeURIComponent(definition.file) +
            ':' +
            roots[node.rootIndex].index +
            ':' +
            relative.join('.') +
            ':' +
            caseIndex,
          definitionId: definition.id,
          name: item.name,
          origin: item.origin,
          path,
          caseIndex,
          mode: item.mode,
        }),
      )
  }
  nodes.forEach((node, index) => {
    const relative = offsets.get(node.rootIndex) ?? 0
    offsets.set(node.rootIndex, relative + 1)
    visit(node, [index], [relative])
  })
  return { version: 1, definitions, cases }
}

function selectTargets(
  nodes: ExecutionNode[],
  catalogue: TargetCatalogue,
  selection: TargetSelection,
): ExecutionNode[] {
  const definitions =
    selection.kind === 'id' ? catalogue.definitions.filter((target) => target.id === selection.id) : []
  const cases =
    selection.kind === 'id'
      ? catalogue.cases.filter((target) => target.id === selection.id)
      : catalogue.cases.filter(
          (target) => target.origin.file === selection.file && target.origin.line === selection.line,
        )
  if (selection.kind === 'location' && !cases.length)
    definitions.push(
      ...catalogue.definitions.filter(
        (target) => target.origin.file === selection.file && target.origin.line === selection.line,
      ),
    )
  if (!definitions.length && !cases.length) throw new TypeError('execution target was not found')
  const roots = new Set(definitions.map((target) => target.rootIndex))
  const visit = (items: ExecutionNode[], parent: number[]): ExecutionNode[] =>
    items.flatMap((node, index) => {
      const path = [...parent, index]
      if (roots.has(node.rootIndex)) return [{ ...node, originalIndex: index }]
      if (node.kind === 'group') {
        const children = visit(node.children, path)
        return children.length ? [{ ...node, originalIndex: index, children }] : []
      }
      const indices = new Set(
        cases
          .filter((target) => JSON.stringify(target.path) === JSON.stringify(path))
          .map((target) => target.caseIndex),
      )
      const selected = node.bp.cases.flatMap((item, caseIndex) =>
        indices.has(caseIndex) ? [{ ...item, originalIndex: caseIndex }] : [],
      )
      return selected.length ? [{ ...node, originalIndex: index, bp: { ...node.bp, cases: selected } }] : []
    })
  return visit(nodes, [])
}

/** 全定義に対する禁止条件を確かめてから、今回扱う対象と集中実行の有無を決める。 */
@Injectable()
export class ExecutionSelection {
  catalogue(allNodes: ExecutionNode[], roots: readonly RootReference[]): TargetCatalogue {
    return catalogueOf(allNodes, roots)
  }

  select(
    allNodes: ExecutionNode[],
    settings: RunSettings,
    roots: readonly RootReference[] = [],
  ): ExecutionSelectionResult {
    const unfilteredOnly = allCases(allNodes).some((item) => item.mode === 'only')
    if (unfilteredOnly && settings.forbidOnly) throw new TypeError('only is forbidden')
    const targets =
      settings.target === undefined ? allNodes : selectTargets(allNodes, catalogueOf(allNodes, roots), settings.target)
    const nodes = settings.filter === undefined ? targets : filterNodes(targets, settings.filter)
    if (!nodes.length) throw new TypeError('filter matched no cases')
    const only = allCases(nodes).some((item) => item.mode === 'only')
    return { nodes, only }
  }
}
