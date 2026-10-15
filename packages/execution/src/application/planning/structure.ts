import { Injectable } from '@zeltjs/core'
import type { Resource } from '@hanamaru/blueprint/model'
import { checkedResources } from '@hanamaru/blueprint/model'
import type { RuntimeBlueprint, RuntimeMock } from '@hanamaru/blueprint/model'
import type { SourceLocation } from '@hanamaru/blueprint/model'
import { configWith, defaultExecutionConfig } from '../../domain/execution/config.js'
import type { ExecutionNode, Frame } from '../../domain/execution/model.js'
import { overlayMocks } from '../execution/plan.js'

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

/** 定義の階層を展開し、各テストへ親の共通条件と出典を織り込む。 */
@Injectable()
export class ExecutionStructure {
  build(blueprints: RuntimeBlueprint[]): ExecutionNode[] {
    return blueprints.flatMap((bp, index) => expand(bp, index, defaultExecutionConfig, [], [], null))
  }
}
