import { Injectable, inject } from '@zeltjs/core'
import * as v from 'valibot'
import type { RunOptions, RunSettings } from '../../application/execution/options.js'
import { RunTests } from '../../application/usecases/run-tests.js'
import { RunLifecycle } from '../../application/execution/lifecycle.js'
import type { Deadline, Progress } from '../../application/execution/state.js'
import type { MutableRunResult } from '../../domain/result/mutable.js'
import type { RuntimeBlueprint } from '../../domain/definition/runtime.js'
import type { TestDefinition } from '../../domain/definition/types.js'
import { validatedBlueprints } from '../../domain/definition/validation.js'
import { finalizeRun } from '../../domain/result/finalize.js'
import type { RunResult } from '../../domain/result/types.js'
import type { Value } from '../../foundation/value.js'
import { arrayValue } from '../../foundation/value.js'
import { DefinitionBuilder, isDefinition } from './definition.js'

function completedDefinitions(input: Value): DefinitionBuilder[] {
  const definitions = Array.isArray(input) ? arrayValue(input) : [input]
  if (!definitions.length || definitions.some((x) => !isDefinition(x)))
    throw new TypeError('run requires completed definitions')
  return definitions.map((def: Value) => v.parse(v.instance(DefinitionBuilder), def))
}

export function collectBlueprints(input: Value): RuntimeBlueprint[] {
  return validatedBlueprints(completedDefinitions(input))
}

/**
 * 公開RunOptionsの構造的な拡張として内部指定を受け取る、ライブラリ入口の形。
 * 利用者callbackはこの入口で接続し、実行サービスの引数には渡さない。
 */
export interface RunInput extends RunSettings {
  readonly onProgress?: (progress: Progress) => void
  readonly onDeadline?: (deadline: Deadline) => void
  readonly onTimeout?: (result: MutableRunResult) => void
  readonly signal?: AbortSignal
}

@Injectable()
export class LibraryRun {
  readonly #lifecycle: RunLifecycle
  readonly #tests: RunTests

  constructor(lifecycle = inject(RunLifecycle), tests = inject(RunTests)) {
    this.#lifecycle = lifecycle
    this.#tests = tests
  }

  run(input: TestDefinition | readonly TestDefinition[], options: RunOptions = {}): Promise<RunResult> {
    return this.#run(input, options)
  }

  async #run(input: TestDefinition | readonly TestDefinition[], options: RunOptions): Promise<RunResult> {
    const received: RunInput = options
    const stopObserving = this.#lifecycle.observe((event) => {
      if (event.kind === 'progress') received.onProgress?.(event.progress)
      else if (event.kind === 'deadline') received.onDeadline?.(event.deadline)
      else received.onTimeout?.(this.#lifecycle.capture('timeout'))
    })
    try {
      return finalizeRun(await this.#tests.execute(completedDefinitions(input), received, received.signal))
    } finally {
      stopObserving()
    }
  }
}
