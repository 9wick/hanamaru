import { onTest } from '@zeltjs/testing/vitest'
import { createApp } from '@zeltjs/core'
import { override } from '@zeltjs/core/internal-bridge/testing'
import { expect, expectTypeOf, test } from 'vite-plus/test'
import * as v from 'valibot'
import { Test, constant, environment, tuples } from '../../../../../src/index.js'
import type { Expect, RunResult } from '../../../../../src/index.js'
import { WorkerExecutionLauncher } from '../workers/client.js'
import { InlineRunHarness, LocalExecutor } from '../../testing/inline-execution.test.js'
import { runResultSchema } from '../../domain/result/schemas.js'
import type { Value } from '../../domain/execution/javascript.js'

async function harness() {
  const scope = await onTest(createApp([]))
  override(scope, [{ provide: WorkerExecutionLauncher, useValue: await scope.get(LocalExecutor) }])
  return scope.get(InlineRunHarness)
}
function firstAttempt(result: RunResult) {
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  const attempt = node.cases[0].attempts[0]
  expect.assert(attempt !== undefined)
  return attempt
}
const shared = { value: 1 }
class First {
  value = 1
}
class Second {
  value = 1
}
const rows: { name: string; actual: Value; expected: Value; matcher: 'toEqual' | 'toBe'; matches: boolean }[] = [
  { name: 'same number', actual: 3, expected: 3, matcher: 'toEqual', matches: true },
  { name: 'different number', actual: 3, expected: 4, matcher: 'toEqual', matches: false },
  { name: 'NaN identity', actual: NaN, expected: NaN, matcher: 'toBe', matches: true },
  { name: 'signed zero identity', actual: -0, expected: 0, matcher: 'toBe', matches: false },
  { name: 'shared identity', actual: shared, expected: shared, matcher: 'toBe', matches: true },
  { name: 'different identity', actual: { value: 1 }, expected: { value: 1 }, matcher: 'toBe', matches: false },
  { name: 'structural equality', actual: { value: 1 }, expected: { value: 1 }, matcher: 'toEqual', matches: true },
  { name: 'prototype equality', actual: new First(), expected: new First(), matcher: 'toEqual', matches: true },
  { name: 'different prototype', actual: new First(), expected: new Second(), matcher: 'toEqual', matches: false },
  {
    name: 'typed bytes',
    actual: new Uint8Array([1, 2]),
    expected: new Uint8Array([1, 2]),
    matcher: 'toEqual',
    matches: true,
  },
  { name: 'unordered set', actual: new Set([1, 2]), expected: new Set([2, 1]), matcher: 'toEqual', matches: true },
]
test.each(rows)('$name follows its documented comparison', async ({ actual, expected, matcher, matches }) => {
  const library = await harness()
  const definition = new Test()
    .target((value: Value) => value)
    .it('comparison', (t) => t.args(actual).expect((e) => [e.result[matcher](expected)]))
  const result = await library.run(definition)
  expect(result.status).toBe(matches ? 'passed' : 'failed')
  expect(firstAttempt(result).assertions[0]?.status).toBe(matches ? 'passed' : 'failed')
  v.parse(runResultSchema, result)
})

test('concrete examples have partial and tolerance checks, without arbitrary predicates or not', async () => {
  const library = await harness()
  const selected = new Test().target(() => ({ total: 0.1 + 0.2, label: 'ready' }))
  expectTypeOf<'mock'>().not.toExtend<keyof typeof selected>()
  type Result = Expect<() => number, {}>['result']
  expectTypeOf<'not'>().not.toExtend<keyof Result>()
  expectTypeOf<'toSatisfy'>().not.toExtend<keyof Result>()
  const definition = selected.it('partial', (t) => {
    expect('mock' in t).toBe(false)
    expect('calls' in t).toBe(false)
    const args = t.args()
    expect('expectCalls' in args).toBe(false)
    return args.expect((e) => [
      e.result.part('label').toEqual('ready'),
      e.result.part('total').toBeCloseTo(0.3, { absoluteTolerance: 1e-12 }),
    ])
  })
  expect((await library.run(definition)).status).toBe('passed')
})

test.each([
  { actual: new TypeError('bad'), status: 'passed' },
  { actual: new TypeError('other'), status: 'failed' },
  { actual: new Error('bad'), status: 'failed' },
  { actual: 'bad', status: 'failed' },
])('error type and message must both match: $status', async ({ actual, status }) => {
  const library = await harness()
  const definition = new Test()
    .target(() => {
      throw actual
    })
    .it('throw contract', (t) => t.args().expect((e) => [e.error.ofType(TypeError).part('message').toEqual('bad')]))
  expect((await library.run(definition)).status).toBe(status)
})

test('property false and predicate exceptions remain distinct failures', async () => {
  const library = await harness()
  const definition = new Test()
    .target((n: number) => n)
    .property('false', (p) =>
      p.forAll(tuples(constant(1))).expect((e) => [e.on(e.result).satisfies('negative', (n) => n < 0)]),
    )
    .property('throws', (p) =>
      p.forAll(tuples(constant(1))).expect((e) => [
        e.on(e.result).satisfies('broken predicate', () => {
          throw new Error('predicate error')
        }),
      ]),
    )
  const result = await library.run(definition)
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  expect(node.cases[0].attempts[0]?.failures[0]?.kind).toBe('assertion')
  expect(node.cases[1].attempts[0]?.failures[0]).toMatchObject({ kind: 'execution', phase: 'assert' })
})

test.each([
  { count: 0, expected: 0, status: 'passed' },
  { count: 2, expected: 1, status: 'failed' },
])('action count is observed: $status', async ({ count, expected, status }) => {
  const library = await harness()
  const local = environment(async (_, scope, next) => {
    const events: number[] = []
    const action = scope.action({
      evidence: 'real-effect',
      open: () => ({ finish: () => [...events], dispose: () => {} }),
    })
    return next({ events, action })
  })
  const definition = new Test()
    .target((events: number[]) => {
      for (let i = 0; i < count; i++) events.push(i)
    })
    .effectful()
    .use(local)
    .it('events', (t) =>
      t.argsFrom((ctx) => [ctx.events]).expect((e) => [e.action(e.ctx.action).untilTargetSettles().count(expected)]),
    )
  expect((await library.run(definition)).status).toBe(status)
})
