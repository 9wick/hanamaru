import { Injectable } from '@zeltjs/core'
import type { Resource } from '@hanamaru/blueprint/model'
import { checkedResources } from '@hanamaru/blueprint/model'
import type { RuntimeBlueprint } from '@hanamaru/blueprint/model'
import type { SourceLocation } from '@hanamaru/blueprint/model'
import { configWith, defaultExecutionConfig } from '../../domain/execution/config.js'
import type { ExecutionNode, Frame } from '../../domain/execution/model.js'

function expand(
  bp: RuntimeBlueprint,
  rootIndex: number,
  config: import('../../domain/execution/config.js').ResolvedExecutionConfig,
  frames: Frame[],
  entryOrigin: SourceLocation | null,
  resources: readonly Resource[] = [],
): ExecutionNode[] {
  const demands = checkedResources([...resources, ...(bp.resources ?? [])])
  const settings = configWith(config, bp.config)
  const currentFrames = [...frames, { steps: bp.steps, fields: {} }]
  if (bp.kind === 'definition')
    return bp.children.flatMap((child) => expand(child, rootIndex, settings, currentFrames, entryOrigin, demands))
  if (bp.kind === 'test')
    return [
      {
        resources: demands,
        kind: 'test',
        rootIndex,
        bp,
        config: settings,
        frames: currentFrames,
        frameCount: currentFrames.length,
        entryOrigin,
      },
    ]
  const children = bp.children.flatMap((entry) =>
    expand(entry.blueprint, rootIndex, settings, currentFrames, entry.origin, demands),
  )
  return [
    {
      resources: demands,
      kind: 'group',
      rootIndex,
      bp,
      children,
      config: settings,
      frames: currentFrames,
      frameCount: currentFrames.length,
      entryOrigin,
    },
  ]
}

/** 定義の階層を展開し、各テストへ親の共通条件と出典を織り込む。 */
@Injectable()
export class ExecutionStructure {
  build(blueprints: RuntimeBlueprint[]): ExecutionNode[] {
    return blueprints.flatMap((bp, index) => expand(bp, index, defaultExecutionConfig, [], null))
  }
}
