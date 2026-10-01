import * as v from 'valibot'
import type { RunOptions, RunSettings } from '../../application/execution/options.js'
import { createPlan } from '../../application/execution/plan.js'
import { runActive } from '../../application/execution/runner.js'
import type { RunListeners } from '../../application/execution/services.js'
import { createRunServices } from '../../application/execution/services.js'
import type { Comparison } from '../../application/ports/comparison.js'
import type { RuntimeBlueprint } from '../../domain/definition/runtime.js'
import type { TestDefinition } from '../../domain/definition/types.js'
import { validatedBlueprints } from '../../domain/definition/validation.js'
import { finalizeRun } from '../../domain/result/finalize.js'
import type { RunResult } from '../../domain/result/types.js'
import type { Value } from '../../foundation/value.js'
import { arrayValue } from '../../foundation/value.js'
import { DefinitionBuilder, isDefinition } from './definition.js'

export function collectBlueprints(input: Value): RuntimeBlueprint[] {
  const definitions = Array.isArray(input) ? arrayValue(input) : [input]
  if (!definitions.length || definitions.some((x) => !isDefinition(x)))
    throw new TypeError('run requires completed definitions')
  return validatedBlueprints(definitions.map((def: Value) => v.parse(v.instance(DefinitionBuilder), def)))
}

/**
 * 公開RunOptionsの構造的な拡張として内部指定を受け取る、ライブラリ入口の形。
 * 設定とサービスを同じ物に載せるのはこの入口だけで、実行へ渡す前に分ける。
 */
export interface RunInput extends RunSettings, RunListeners {
  readonly signal?: AbortSignal
}

export function createRun(comparison: Comparison) {
  return async function run(
    input: TestDefinition | readonly TestDefinition[],
    options: RunOptions = {},
  ): Promise<RunResult> {
    const received: RunInput = options
    return finalizeRun(
      await runActive(() => createPlan(collectBlueprints(input), received), received, {
        comparison,
        run: createRunServices(received),
        signal: received.signal,
      }),
    )
  }
}
