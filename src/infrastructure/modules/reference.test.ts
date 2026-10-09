import { createTestTarget } from '@zeltjs/testing/vitest'
import { expect, test } from 'vite-plus/test'
import type { TestDefinition } from '../../index.js'
import { Test, middleware, relation } from '../../index.js'
import { ExecutionPlanner } from '../../application/planning/planner.js'
import { defaultMiddlewareTimeoutMs } from '../../domain/execution/config.js'
import { collectBlueprints } from '../../interfaces/library/run.js'
import { ModuleRegistry } from './reference.js'

const add = (a: number, b: number): number => a + b

type Exports = Record<string, (value: number) => number>

/** 実行時のmodule namespaceと同じ目印を持つ入れ物。登録済みかどうかだけが準備対象を決める。 */
function namespace(exports: Exports): Exports {
  return Object.defineProperty({ ...exports }, Symbol.toStringTag, { value: 'Module' })
}

test('preparation lists every mocked and observed key once per registered module', async () => {
  const { target: registry } = await createTestTarget(ModuleRegistry)
  const alpha = namespace({ read: (n) => n, write: (n) => n })
  const beta = namespace({ load: (n) => n })
  registry.register(alpha, '/alpha.ts')
  registry.register(beta, '/beta.ts')
  const definition = new Test()
    .mock(alpha, 'read', (m) => m.returns(1))
    .target(add)
    .it('observes', (t) =>
      t
        .mock(alpha, 'write', (m) => m.returns(2))
        .args(1, 2)
        .expect((e) => [e.result.toBe(3)])
        .expectCalls((call) => [call(alpha, 'read').calledTimes(1), call(beta, 'load').notCalled()]),
    )
    .it('repeats', (t) =>
      t
        .mock(alpha, 'read', (m) => m.returns(3))
        .args(1, 2)
        .expect((e) => [e.result.toBe(3)]),
    )
    .todo('later')
  expect(registry.prepare(collectBlueprints(definition))).toStrictEqual([
    { id: '/alpha.ts', keys: ['read', 'write'] },
    { id: '/beta.ts', keys: ['load'] },
  ])
})

test('preparation visits group children', async () => {
  const { target: registry } = await createTestTarget(ModuleRegistry)
  const alpha = namespace({ read: (n) => n })
  registry.register(alpha, '/nested.ts')
  const child = new Test().target(add).it('mocks', (t) =>
    t
      .mock(alpha, 'read', (m) => m.returns(1))
      .args(1, 2)
      .expect((e) => [e.result.toBe(3)]),
  )
  const definition = new Test().group([child])
  expect(registry.prepare(collectBlueprints(definition))).toStrictEqual([{ id: '/nested.ts', keys: ['read'] }])
})

test('ordinary fixture objects need no preparation', async () => {
  const { target: registry } = await createTestTarget(ModuleRegistry)
  const fixture = { read: (n: number) => n }
  const definition = new Test().target(add).it('mocks', (t) =>
    t
      .mock(fixture, 'read', (m) => m.returns(1))
      .args(1, 2)
      .expect((e) => [e.result.toBe(3)]),
  )
  expect(registry.prepare(collectBlueprints(definition))).toStrictEqual([])
})

test('a module namespace the runtime did not load is rejected with the key that referenced it', async () => {
  const { target: registry } = await createTestTarget(ModuleRegistry)
  const stray = namespace({ read: (n) => n })
  const definition = new Test().target(add).it('mocks', (t) =>
    t
      .mock(stray, 'read', (m) => m.returns(1))
      .args(1, 2)
      .expect((e) => [e.result.toBe(3)]),
  )
  expect(() => registry.prepare(collectBlueprints(definition))).toThrow(
    /module was loaded outside the test runtime: read/,
  )
})

test('context fixtures named by call.from are resolved at execution, not during preparation', async () => {
  const { target: registry } = await createTestTarget(ModuleRegistry)
  const definition = new Test().target(add).it('observes', (t) =>
    t
      .args(1, 2)
      .expect((e) => [e.result.toBe(3)])
      .expectCalls((call) => [call.from(() => ({ read: (n: number) => n }), 'read').notCalled()]),
  )
  expect(registry.prepare(collectBlueprints(definition))).toStrictEqual([])
})

async function shapeOf(definition: TestDefinition): Promise<string> {
  const { target: registry, get } = await createTestTarget(ModuleRegistry)
  const planner = await get(ExecutionPlanner)
  return JSON.stringify(registry.describe(planner.create(collectBlueprints(definition)).allNodes))
}

function groupWith(options: { timeout?: number }): TestDefinition {
  const child = new Test().target(add).it('adds', (t) => t.args(1, 2).expect((e) => [e.result.toBe(3)]))
  return new Test().group(
    middleware(async (_, next) => next(), options),
    [child],
  )
}

test('execution plan shape materializes the default middleware timeout', async () => {
  const implicit = await shapeOf(groupWith({}))
  expect(implicit).toContain(`"middleware":{"timeout":${defaultMiddlewareTimeoutMs}}`)
  // 収集workerと実行workerはこの文字列だけで定義の同一性を判定するため、
  // 既定値が展開されないと明示指定と暗黙指定が別物として扱われる。
  expect(implicit).toBe(await shapeOf(groupWith({ timeout: defaultMiddlewareTimeoutMs })))
})

test('execution plan shape distinguishes call dependencies, member names and output names', async () => {
  const target = new Test().target(relation({ double: (n: number) => n * 2 }))
  const dependent = target.it('calls', (t) =>
    t.calls((c) => c.double.args(c.double.args(1))).expect((e) => [e.result.toBe(4)]),
  )
  const independent = target.it('calls', (t) =>
    t
      .calls((c) => ({ first: c.double.args(1), second: c.double.args(1) }))
      .expect((e) => [e.result.toEqual({ first: 2, second: 2 })]),
  )
  const aliased = target.it('calls', (t) =>
    t
      .calls((c) => {
        const first = c.double.args(1)
        return { first, second: first }
      })
      .expect((e) => [e.result.toEqual({ first: 2, second: 2 })]),
  )
  expect(await shapeOf(dependent)).not.toBe(await shapeOf(independent))
  expect(await shapeOf(independent)).not.toBe(await shapeOf(aliased))
  expect(await shapeOf(dependent)).toContain('"members":["double"]')
})
