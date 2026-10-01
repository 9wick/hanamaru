import type { ConfigClass } from '@zeltjs/core'
import { createApp } from '@zeltjs/core'
import * as v from 'valibot'
import type { RunOptions, RunSettings } from '../../application/execution/options.js'
import { runExclusively } from '../../application/execution/current-run.js'
import { createPlan } from '../../application/execution/plan.js'
import { LocalExecutor } from '../../application/execution/local.js'
import { RunWalker } from '../../application/execution/runner.js'
import type { RunListeners } from '../../application/execution/services.js'
import { ListenerEvents, RunSnapshot } from '../../application/execution/services.js'
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

/**
 * 1回のrunぶんのscopeを立てて畳む入口。runを辿る一式はこのscopeが持つため、
 * 利用者がcontainerを組み立てる必要はない。
 */
export function createRun(comparison: ConfigClass<Comparison>) {
  return function run(input: TestDefinition | readonly TestDefinition[], options: RunOptions = {}): Promise<RunResult> {
    const received: RunInput = options
    // 錠はscopeを立てるより先に取る。収集の途中で始まったrunも重なりとして弾く。
    return runExclusively(async () => {
      const scope = await createApp([]).createRuntime({ configs: [comparison, LocalExecutor] })
      try {
        // 受け取り手は呼び出しの引数で決まる。1回ぶんの通知の宛先として組み立てて渡す。
        const events = new ListenerEvents(received, await scope.get(RunSnapshot))
        const walker = await scope.get(RunWalker)
        const execution = await (await scope.get(LocalExecutor)).start(events)
        try {
          return finalizeRun(
            await walker.run(
              execution,
              () => createPlan(collectBlueprints(input), received),
              received,
              events,
              received.signal,
            ),
          )
        } finally {
          await execution.close()
        }
      } finally {
        await scope.shutdown()
      }
    })
  }
}
