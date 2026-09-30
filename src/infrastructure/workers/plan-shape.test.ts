import { expect, test } from 'vite-plus/test'
import type { TestDefinition } from '../../index.js'
import { Test, middleware } from '../../index.js'

import { createPlan } from '../../application/execution/plan.js'
import { collectBlueprints } from '../../interfaces/library/run.js'
import { describeExecutionPlan } from './plan-shape.js'

import { defaultMiddlewareTimeoutMs } from '../../domain/execution/config.js'

const add = (a: number, b: number): number => a + b

function shapeOf(definition: TestDefinition): string {
  return JSON.stringify(describeExecutionPlan(createPlan(collectBlueprints(definition)).allNodes))
}

function groupWith(options: { timeout?: number }): TestDefinition {
  const child = new Test().target(add).it('adds', (t) => t.args(1, 2).expect((e) => [e.result.toBe(3)]))
  return new Test().group(
    middleware(async (_, next) => next(), options),
    [child],
  )
}

test('execution plan shape materializes the default middleware timeout', () => {
  const implicit = shapeOf(groupWith({}))
  expect(implicit).toContain(`"middleware":{"timeout":${defaultMiddlewareTimeoutMs}}`)
  // 収集workerと実行workerはこの文字列だけで定義の同一性を判定するため、
  // 既定値が展開されないと明示指定と暗黙指定が別物として扱われる。
  expect(implicit).toBe(shapeOf(groupWith({ timeout: defaultMiddlewareTimeoutMs })))
})
