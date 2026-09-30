import * as v from 'valibot'
import type { RunOptions } from '../../application/execution/options.js'
import { createPlan } from '../../application/execution/plan.js'
import { runActive } from '../../application/execution/runner.js'
import type { Comparison } from '../../application/ports/comparison.js'
import type { RuntimeBlueprint } from '../../domain/definition/runtime.js'
import type { TestDefinition } from '../../domain/definition/types.js'
import { validateBlueprint } from '../../domain/definition/validation.js'
import { finalizeRun } from '../../domain/result/finalize.js'
import type { RunResult } from '../../domain/result/types.js'
import type { Value } from '../../foundation/value.js'
import { arrayValue } from '../../foundation/value.js'
import { DefinitionBuilder, isDefinition } from './definition.js'

export function collectBlueprints(input: Value): RuntimeBlueprint[] {
  const definitions = Array.isArray(input) ? arrayValue(input) : [input]
  if (!definitions.length || definitions.some((x) => !isDefinition(x)))
    throw new TypeError('run requires completed definitions')
  const blueprints = definitions.map((def: Value) => {
    if (!isDefinition(def)) throw new TypeError('run requires completed definitions')
    return v.parse(v.instance(DefinitionBuilder), def).blueprint()
  })
  blueprints.forEach((bp) => validateBlueprint(bp))
  return blueprints
}

export function createRun(comparison: Comparison) {
  return async function run(
    input: TestDefinition | readonly TestDefinition[],
    options: RunOptions = {},
  ): Promise<RunResult> {
    return finalizeRun(await runActive(() => createPlan(collectBlueprints(input), options), options, comparison))
  }
}
