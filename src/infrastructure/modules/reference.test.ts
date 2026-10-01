import { expect, test } from 'vite-plus/test'
import type { TestDefinition } from '../../index.js'
import { Test, middleware } from '../../index.js'
import { createPlan } from '../../application/execution/plan.js'
import { defaultMiddlewareTimeoutMs } from '../../domain/execution/config.js'
import { collectBlueprints } from '../../interfaces/library/run.js'
import { ModuleRegistry } from './reference.js'

const add = (a: number, b: number): number => a + b

const registry = new ModuleRegistry()

type Exports = Record<string, (value: number) => number>

/** 実行時のmodule namespaceと同じ目印を持つ入れ物。登録済みかどうかだけが準備対象を決める。 */
function namespace(exports: Exports): Exports {
  return Object.defineProperty({ ...exports }, Symbol.toStringTag, { value: 'Module' })
}

test('preparation lists every mocked and observed key once per registered module', () => {
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

test('preparation visits group children', () => {
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

test('ordinary fixture objects need no preparation', () => {
  const fixture = { read: (n: number) => n }
  const definition = new Test().target(add).it('mocks', (t) =>
    t
      .mock(fixture, 'read', (m) => m.returns(1))
      .args(1, 2)
      .expect((e) => [e.result.toBe(3)]),
  )
  expect(registry.prepare(collectBlueprints(definition))).toStrictEqual([])
})

test('a module namespace the runtime did not load is rejected with the key that referenced it', () => {
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

test('context fixtures named by call.from are resolved at execution, not during preparation', () => {
  const definition = new Test().target(add).it('observes', (t) =>
    t
      .args(1, 2)
      .expect((e) => [e.result.toBe(3)])
      .expectCalls((call) => [call.from(() => ({ read: (n: number) => n }), 'read').notCalled()]),
  )
  expect(registry.prepare(collectBlueprints(definition))).toStrictEqual([])
})

function shapeOf(definition: TestDefinition): string {
  return JSON.stringify(new ModuleRegistry().describe(createPlan(collectBlueprints(definition)).allNodes))
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
