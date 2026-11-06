import { createTestTarget } from '@zeltjs/testing/vitest'
import { expect, test } from 'vite-plus/test'
import type { TestDefinition, ItDone } from '../../../../../src/index.js'
import {
  Test,
  middleware,
  environment,
  scenario,
  method,
  integers,
  tuples,
  constant,
} from '../../../../../src/index.js'
import type { ScenarioItBuilder } from '../../../../blueprint/src/interfaces/library/scenario-types.js'
import { ExecutionPlanner } from '../../application/planning/planner.js'
import { defaultMiddlewareTimeoutMs } from '../../domain/execution/config.js'
import { collectBlueprints } from '../../testing/inline-execution.test.js'
import { ExecutionModules } from './modules.js'
import { ExecutionModules as WorkerModules } from '../../../../execution/src/infrastructure/execution/modules.js'

const add = (a: number, b: number): number => a + b
async function shapeOf(definition: TestDefinition): Promise<string> {
  const { target: modules, get } = await createTestTarget(ExecutionModules)
  const planner = await get(ExecutionPlanner)
  const nodes = planner.create(collectBlueprints(definition)).allNodes
  const shape = modules.describe(nodes)
  expect(new WorkerModules().describe(nodes)).toEqual(shape)
  return JSON.stringify(shape)
}
function groupWith(options: { timeout?: number }): TestDefinition {
  const child = new Test().target(add).it('adds', (t) => t.args(1, 2).expect((e) => [e.result.toEqual(3)]))
  return new Test().group(
    middleware(async (_, next) => next(), options),
    [child],
  )
}

test('plan shape materializes the default middleware timeout', async () => {
  const implicit = await shapeOf(groupWith({}))
  expect(implicit).toContain(`"middleware":{"timeout":${defaultMiddlewareTimeoutMs}}`)
  expect(implicit).toBe(await shapeOf(groupWith({ timeout: defaultMiddlewareTimeoutMs })))
})

test('plan shape retains declared targets and different step builders without compiling them', async () => {
  const members = { double: (n: number) => n * 2 }
  const suite = (build: (t: ScenarioItBuilder<typeof members, {}, 'pure'>) => ItDone) =>
    new Test().target(scenario(members)).it('plan', build)
  let compilations = 0
  const dependent = suite((t) =>
    t
      .steps((s) => {
        compilations++
        return s.double.args(s.double.args(1))
      })
      .expect((e) => [e.result.toEqual(4)]),
  )
  const independent = suite((t) =>
    t
      .steps((s) => ({ first: s.double.args(1), second: s.double.args(1) }))
      .expect((e) => [e.result.toEqual({ first: 2, second: 2 })]),
  )
  expect(await shapeOf(dependent)).not.toBe(await shapeOf(independent))
  expect(await shapeOf(dependent)).toContain('"key":"double"')
  expect(compilations).toBe(0)
})

test('plan shape includes characteristic, case kind and generated input configuration', async () => {
  const target = (n: number) => n
  const define = (min: number) =>
    new Test()
      .target(target)
      .property('range', (p) =>
        p
          .forAll(tuples(integers({ min, max: 10 })), { seed: 4, runs: 8 })
          .expect((e) => [e.on(e.result).satisfies('finite', Number.isFinite)]),
      )
  const first = await shapeOf(define(0))
  expect(first).toContain('"characteristic":"pure"')
  expect(first).toContain('"caseKind":"property"')
  expect(first).toContain('"runs":8')
  expect(first).not.toBe(await shapeOf(define(1)))
  expect(first).toBe(await shapeOf(define(0)))
})

test('shape supports non-JSON generated data and does not execute environment or receivers', async () => {
  let prepared = 0,
    resolved = 0
  class Service {
    run(value: Map<string, bigint>) {
      return value
    }
  }
  const local = environment(async (_, _scope, next) => {
    prepared++
    return next({ service: new Service() })
  })
  const suite = new Test()
    .target(scenario({ run: method(Service, 'run') }))
    .effectful()
    .use(local)
    .from((ctx) => {
      resolved++
      return { run: ctx.service }
    })
    .property('map', (p) =>
      p
        .forAll(tuples(constant(new Map([['amount', 1n]]))))
        .steps((s) => s.run.args(s.input[0]))
        .expect((e) => [e.result.toEqual(new Map([['amount', 1n]]))]),
    )
  const shape = await shapeOf(suite)
  expect(shape).toContain('"characteristic":"effectful"')
  expect(shape).toContain('"method":"run"')
  expect(shape).toContain('bigint')
  expect(prepared).toBe(0)
  expect(resolved).toBe(0)
})
