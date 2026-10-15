import { Injectable, inject } from '@zeltjs/core'
import type { RuntimeBlueprint } from '@hanamaru/blueprint/model'
import type { MutableRunResult } from '../../domain/result/mutable.js'
import { nodeSources, withSources, type TestSource } from '../../domain/result/source.js'
import { RunContext } from '../execution/context.js'
import { RunLifecycle } from '../execution/lifecycle.js'
import type { RunSettings } from '../execution/options.js'
import { PlanExecutor } from '../execution/runner.js'
import { ExecutionPlanner } from '../planning/planner.js'
import { ExecutionLauncher } from '../ports/executor.js'
import type { RootReference } from '../ports/root-reference.js'

export interface RunPreparation {
  readonly roots: RootReference[]
  readonly timeout: number
  readonly sources?: readonly TestSource[]
}

/** 定義の取得後の共通フロー。計画を作り、workerへ指示し、全体結果を返す。 */
@Injectable()
export class RunTests {
  readonly #planner: ExecutionPlanner
  readonly #execution: PlanExecutor
  readonly #context: RunContext
  readonly #backend: ExecutionLauncher
  readonly #lifecycle: RunLifecycle
  constructor(
    planner = inject(ExecutionPlanner),
    execution = inject(PlanExecutor),
    context = inject(RunContext),
    backend = inject(ExecutionLauncher),
    lifecycle = inject(RunLifecycle),
  ) {
    this.#planner = planner
    this.#execution = execution
    this.#context = context
    this.#backend = backend
    this.#lifecycle = lifecycle
  }
  catalogue(blueprints: RuntimeBlueprint[], roots: readonly RootReference[]) {
    return this.#planner.catalogue(blueprints, roots)
  }

  executeBlueprints(
    blueprints: RuntimeBlueprint[],
    settings: RunSettings,
    signal: AbortSignal | undefined,
    preparation: RunPreparation,
  ): Promise<MutableRunResult> {
    return this.#context.run(async () => {
      const plan = this.#planner.create(blueprints, settings, preparation.roots)
      const sources = preparation.sources ? nodeSources(plan.allNodes, preparation.sources) : null
      if (sources) this.#lifecycle.sources(sources)
      await this.#backend.initialize(
        plan,
        preparation.roots,
        signal ?? new AbortController().signal,
        preparation.timeout,
      )
      this.#lifecycle.initialized()
      const result = await this.#execution.execute(plan, settings, signal)
      return sources ? withSources(result, sources) : result
    })
  }
}
