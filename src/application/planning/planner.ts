import { Injectable, inject } from '@zeltjs/core'
import type { RuntimeBlueprint } from '../../domain/definition/runtime.js'
import type { Plan } from '../../domain/execution/model.js'
import type { RunSettings } from '../execution/options.js'
import { ExecutionStructure } from './structure.js'
import { ExecutionSelection } from './selection.js'
import { ResourcePlanner } from './resources.js'

/** 定義から構造、対象、必要資源の順に決め、今回の実行計画を返す。 */
@Injectable()
export class ExecutionPlanner {
  readonly #structure: ExecutionStructure
  readonly #selection: ExecutionSelection
  readonly #resources: ResourcePlanner

  constructor(
    structure = inject(ExecutionStructure),
    selection = inject(ExecutionSelection),
    resources = inject(ResourcePlanner),
  ) {
    this.#structure = structure
    this.#selection = selection
    this.#resources = resources
  }

  create(blueprints: RuntimeBlueprint[], settings: RunSettings = {}): Plan {
    const allNodes = this.#structure.build(blueprints)
    const { nodes, only } = this.#selection.select(allNodes, settings)
    const resources = this.#resources.plan(nodes, only)
    return { blueprints, allNodes, nodes, only, resources }
  }
}
