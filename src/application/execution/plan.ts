import type { Resource } from '../../domain/definition/resource.js'
import { checkedResources, resourceGraph } from '../../domain/definition/resource.js'
import type { CaseBlueprint, RuntimeBlueprint, RuntimeMock } from '../../domain/definition/runtime.js'
import type { SourceLocation } from '../../domain/definition/types.js'
import { configWith, defaultExecutionConfig } from '../../domain/execution/config.js'
import type { ExecutionNode, Frame, Plan } from '../../domain/execution/model.js'
import type { RunSettings } from './options.js'

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

export function overlayMocks(base: RuntimeMock[], own: RuntimeMock[]) {
  const merged = [...base]
  for (const mock of own) {
    const index = merged.findIndex((x) => x.object === mock.object && x.key === mock.key)
    if (index < 0) merged.push(mock)
    else merged[index] = mock
  }
  return merged
}

function expand(
  bp: RuntimeBlueprint,
  rootIndex: number,
  config: import('../../domain/execution/config.js').ResolvedExecutionConfig,
  mocks: RuntimeMock[],
  frames: Frame[],
  entryOrigin: SourceLocation | null,
  resources: readonly Resource[] = [],
): ExecutionNode[] {
  const demands = checkedResources([...resources, ...(bp.resources ?? [])])
  const settings = configWith(config, bp.config)
  const currentMocks = overlayMocks(mocks, bp.mocks)
  const currentFrames = [...frames, { steps: bp.steps, fields: {} }]
  if (bp.kind === 'definition')
    return bp.children.flatMap((child) =>
      expand(child, rootIndex, settings, currentMocks, currentFrames, entryOrigin, demands),
    )
  if (bp.kind === 'test')
    return [
      {
        resources: demands,
        kind: 'test',
        rootIndex,
        bp,
        config: settings,
        mocks: currentMocks,
        frames: currentFrames,
        frameCount: currentFrames.length,
        entryOrigin,
      },
    ]
  const children = bp.children.flatMap((entry) =>
    expand(entry.blueprint, rootIndex, settings, currentMocks, currentFrames, entry.origin, demands),
  )
  return [
    {
      resources: demands,
      kind: 'group',
      rootIndex,
      bp,
      children,
      config: settings,
      mocks: currentMocks,
      frames: currentFrames,
      frameCount: currentFrames.length,
      entryOrigin,
    },
  ]
}

export function allCases(nodes: ExecutionNode[]): CaseBlueprint[] {
  return nodes.flatMap((node) => (node.kind === 'test' ? node.bp.cases : allCases(node.children)))
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

export function createPlan(blueprints: RuntimeBlueprint[], settings: RunSettings = {}): Plan {
  const allNodes = blueprints.flatMap((bp, index) => expand(bp, index, defaultExecutionConfig, [], [], null))
  const unfilteredOnly = allCases(allNodes).some((item) => item.mode === 'only')
  if (unfilteredOnly && settings.forbidOnly) throw new TypeError('only is forbidden')
  const nodes = settings.filter === undefined ? allNodes : filterNodes(allNodes, settings.filter)
  if (!nodes.length) throw new TypeError('filter matched no cases')
  const only = allCases(nodes).some((item) => item.mode === 'only')
  const roots: Resource[] = []
  const visit = (items: ExecutionNode[]): void => {
    for (const node of items) {
      if (node.kind === 'group') visit(node.children)
      else
        for (const item of node.bp.cases)
          if (item.mode !== 'skip' && item.mode !== 'todo' && (!only || item.mode === 'only'))
            roots.push(...(node.resources ?? []), ...(item.resources ?? []))
    }
  }
  visit(nodes)
  return { blueprints, allNodes, nodes, only, resources: resourceGraph(roots) }
}
