import { Injectable, inject } from '@zeltjs/core'
import type { RuntimeDefinitionHandle } from '@hanamaru/blueprint/model'
import type { MutableRunResult } from '../../domain/result/mutable.js'
import { DefinitionCollector } from '../collection/definitions.js'
import { RunContext } from '../execution/context.js'
import type { RunSettings } from '../execution/options.js'
import { PlanExecutor } from '../execution/runner.js'
import { ExecutionPlanner } from '../planning/planner.js'

/** 完成した定義を受け取り、収集・計画作成・計画実行を通して結果を返す。 */
@Injectable()
export class RunTests {
  readonly #definitions: DefinitionCollector
  readonly #planner: ExecutionPlanner
  readonly #execution: PlanExecutor
  readonly #context: RunContext

  constructor(
    definitions = inject(DefinitionCollector),
    planner = inject(ExecutionPlanner),
    execution = inject(PlanExecutor),
    context = inject(RunContext),
  ) {
    this.#definitions = definitions
    this.#planner = planner
    this.#execution = execution
    this.#context = context
  }

  execute(
    definitions: readonly RuntimeDefinitionHandle[],
    settings: RunSettings,
    signal?: AbortSignal,
  ): Promise<MutableRunResult> {
    return this.#context.run(async () => {
      const blueprints = this.#definitions.collect(definitions)
      const plan = this.#planner.create(blueprints, settings)
      return this.#execution.execute(plan, settings, signal)
    })
  }
}
