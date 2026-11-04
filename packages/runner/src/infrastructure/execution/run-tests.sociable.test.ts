import { onTest } from '@zeltjs/testing/vitest'
import { createApp } from '@zeltjs/core'
import { override } from '@zeltjs/core/internal-bridge/testing'
import { WorkerExecutionLauncher } from '../workers/client.js'
import { expect, test } from 'vite-plus/test'
import { Test, middleware, environment, tuples, constant } from '../../../../../src/index.js'
import type { ItBuilder, ItDone, RunResult, TestResult } from '../../../../../src/index.js'
import type { RunInput } from '../../testing/inline-execution.test.js'
import { InlineRunHarness } from '../../testing/inline-execution.test.js'
import { LocalExecutor } from '../../testing/inline-execution.test.js'
import { invoke } from '../../domain/execution/javascript.js'
import type { Value } from '../../domain/execution/javascript.js'

function testResult(result: RunResult): TestResult {
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  return node
}

const lifecycle: string[] = []
const operations = new Test<{ label: string }>()
  .target((input: number, read: (n: number) => number, label: string) => ({
    values: [read(input), read(input + 1)],
    label,
  }))
  .effectful()
  .use(
    environment(async (_, _scope, next) => {
      lifecycle.push('attempt open')
      try {
        return await next({ input: 3, read: (n: number) => n + 4 })
      } finally {
        lifecycle.push('attempt close')
      }
    }),
  )
  .it('environment fake', (t) =>
    t
      .argsFrom((ctx) => [ctx.input, ctx.read, ctx.label])
      .expect((e) => [e.result.toEqual({ values: [7, 8], label: 'shared' })]),
  )
  .it('explicit dependency', (t) =>
    t
      .argsFrom((ctx) => [ctx.input, () => 9, ctx.label])
      .expect((e) => [e.result.toEqual({ values: [9, 9], label: 'shared' })]),
  )
  .skip('skipped', (t) =>
    t.args(1, (n) => n, 'shared').expect((e) => [e.result.toEqual({ values: [], label: 'shared' })]),
  )
  .todo('todo')

const rows = new Test()
  .target((a: number, b: number) => a + b)
  .each(
    'addition',
    [
      { a: 1, b: 2, expected: 3 },
      { a: 2, b: 3, expected: 5 },
    ],
    (t, row) => t.args(row.a, row.b).expect((e) => [e.result.toBe(row.expected)]),
  )

const provider = middleware(async (_, next) => {
  lifecycle.push('group open')
  try {
    return await next({ label: 'shared' })
  } finally {
    lifecycle.push('group close')
  }
})

const contracts = new Test().group('contracts', [new Test().group(provider, [operations, rows])])

test('library execution preserves lifecycle, environments, rows, skipped cases and declaration origins', async () => {
  const scope = await onTest(createApp([]))
  override(scope, [{ provide: WorkerExecutionLauncher, useValue: await scope.get(LocalExecutor) }])
  const library = await scope.get(InlineRunHarness)
  expect(lifecycle).toEqual([])
  const blueprint = contracts.blueprint()
  expect(blueprint.kind).toBe('definition')
  expect(lifecycle).toEqual([])
  const result = await library.run(contracts)
  expect(result.status).toBe('passed')
  const outer = result.tests[0]
  expect.assert(outer.kind === 'group')
  const group = outer.children[0].result
  expect.assert(group.kind === 'group')
  expect(group.middleware?.status).toBe('passed')
  const cases = group.children.flatMap((child) => {
    expect.assert(child.result.kind === 'test')
    return child.result.cases
  })
  expect(cases).toHaveLength(6)
  for (const item of cases) {
    expect(item.origin.file).toMatch(/run-tests\.sociable\.test\.ts$/)
    expect(item.origin.line).toBeGreaterThan(0)
    expect(item.origin.column).toBeGreaterThan(0)
    if (item.notRun) {
      expect(item.attempts).toEqual([])
      expect(item.durationMs).toBe(0)
    } else {
      expect(item.attempts[0].status).toBe('passed')
      expect(item.attempts[0].cleanup).toBe('complete')
    }
  }
  expect(cases.slice(2, 4).map((item) => item.notRun)).toEqual(['skipped', 'todo'])
  expect(cases.slice(4).map((item) => item.row?.index)).toEqual([0, 1])
  expect(lifecycle).toEqual([
    'group open',
    'attempt open',
    'attempt close',
    'attempt open',
    'attempt close',
    'group close',
  ])
})

test('library contexts reject container writes while retaining shared object identity', async () => {
  const scope = await onTest(createApp([]))
  override(scope, [{ provide: WorkerExecutionLauncher, useValue: await scope.get(LocalExecutor) }])
  const library = await scope.get(InlineRunHarness)
  const shared = { count: 0 }
  let captured: { readonly shared: typeof shared; readonly answer: number } | undefined
  const specification = new Test()
    .use(middleware(async (_, next) => next({ shared, answer: 42 })))
    .target((state: typeof shared) => ++state.count)
    .it('context', (t) =>
      t
        .argsFrom((ctx) => {
          expect(ctx.shared).toBe(shared)
          captured = ctx
          return [ctx.shared]
        })
        .expect((e) => [e.result.toBe(1)]),
    )
  expect((await library.run(specification)).status).toBe('passed')
  expect(shared.count).toBe(1)
  const context = captured
  expect.assert(context !== undefined)
  for (const mutate of [
    () => Reflect.set(context, 'answer', 0),
    () => Reflect.deleteProperty(context, 'answer'),
    () => Reflect.defineProperty(context, 'answer', { value: 0 }),
  ]) {
    await Promise.allSettled([Promise.resolve().then(mutate)])
    expect(context.answer).toBe(42)
    expect(context.shared).toBe(shared)
  }
})

test('property projections retain saved regex data and distinguish non-Error outcomes', async () => {
  const scope = await onTest(createApp([]))
  override(scope, [{ provide: WorkerExecutionLauncher, useValue: await scope.get(LocalExecutor) }])
  const library = await scope.get(InlineRunHarness)
  const pattern = /boom/g
  pattern.lastIndex = 2
  const specification = new Test()
    .target((value: Error | { message: string }) => Promise.reject(value))
    .property('Error', (p) =>
      p
        .forAll(tuples(constant('boom')))
        .argsFrom((_, sample) => [new Error(sample[0])])
        .expect((e) => [
          e
            .on({
              message: e.error.ofType(Error).field('message'),
              pattern: e.project(e.value(pattern), (value) => ({ source: value.source, flags: value.flags })),
            })
            .satisfies('matches saved pattern', ({ message, pattern }) => {
              return new RegExp(pattern.source, pattern.flags).test(message)
            }),
        ]),
    )
    .it('non-Error', (t) => t.args({ message: 'boom' }).expect((e) => [e.error.message.toEqual('boom')]))
  const result = await library.run(specification)
  expect(result.status).toBe('failed')
  expect(testResult(result).cases.map((item) => item.attempts[0]?.status)).toEqual(['passed', 'failed'])
  expect(pattern.lastIndex).toBe(2)
  expect(testResult(result).cases[1].attempts[0]?.failures[0]?.kind).toBe('assertion')
})

test('library mismatches identify the assertion matcher', async () => {
  const scope = await onTest(createApp([]))
  override(scope, [{ provide: WorkerExecutionLauncher, useValue: await scope.get(LocalExecutor) }])
  const library = await scope.get(InlineRunHarness)
  const specification = new Test()
    .target(() => ({ value: 1 }))
    .it('mismatch', (t) => t.args().expect((e) => [e.result.part('value').toEqual(2)]))
  const result = await library.run(specification)
  expect(result.status).toBe('failed')
  const failure = testResult(result).cases[0].attempts[0]?.failures[0]
  expect.assert(failure?.kind === 'assertion')
  expect(failure.assertion.matcher).toBe('toEqual')
})

test('library results encode dates, regexps and maps', async () => {
  const scope = await onTest(createApp([]))
  override(scope, [{ provide: WorkerExecutionLauncher, useValue: await scope.get(LocalExecutor) }])
  const library = await scope.get(InlineRunHarness)
  const specification = new Test()
    .target(() => [new Date('2020-01-01'), /a/g, new Map([[1, 2]])])
    .it('diagnostic', (t) =>
      t.args().expect((e) => [e.result.toEqual([new Date('2020-01-01'), /a/g, new Map([[1, 2]])])]),
    )
  const result = await library.run(specification)
  const outcome = testResult(result).cases[0].attempts[0]?.outcome
  expect.assert(outcome?.value.kind === 'array')
  expect(outcome.value.items[0]).toMatchObject({ kind: 'date', value: '2020-01-01T00:00:00.000Z' })
  expect(outcome.value.items[1]).toMatchObject({ kind: 'regexp', source: 'a', flags: 'g' })
  expect(outcome.value.items[2]).toMatchObject({
    kind: 'map',
    entries: [
      [
        { kind: 'number', value: 1 },
        { kind: 'number', value: 2 },
      ],
    ],
  })
})

test('library execution enforces only conditions', async () => {
  const scope = await onTest(createApp([]))
  override(scope, [{ provide: WorkerExecutionLauncher, useValue: await scope.get(LocalExecutor) }])
  const library = await scope.get(InlineRunHarness)
  const specification = new Test().target(() => 1).only('only', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  expect((await library.run(specification)).status).toBe('passed')
  const conditions: RunInput = { forbidOnly: true }
  await expect(library.run(specification, conditions)).rejects.toThrow('only is forbidden')
})

const double = (value: number) => value * 2
const targeted = () => new Test().target(double)
const okBody = (t: ItBuilder<typeof double, {}>): ItDone => t.args(2).expect((e) => [e.result.toBe(4)])
async function rejected(act: () => Value): Promise<string> {
  try {
    await Promise.resolve(act())
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  }
  return 'nothing was thrown'
}

test('run works without a collection scope', async () => {
  const scope = await onTest(createApp([]))
  override(scope, [{ provide: WorkerExecutionLauncher, useValue: await scope.get(LocalExecutor) }])
  const library = await scope.get(InlineRunHarness)
  const run = library.run.bind(library)

  const single = targeted().it('single', okBody)
  const grouped = new Test().group([targeted().it('inside a group', okBody)])
  const result = await run([single, grouped])
  expect(result.status).toBe('passed')
  expect(result.tests.map((node) => node.kind)).toEqual(['test', 'group'])
})

test.each([
  ['an empty list', []],
  ['an unfinished definition', new Test()],
  ['a plain object', {}],
])('run rejects %s', async (_label, input) => {
  const scope = await onTest(createApp([]))
  override(scope, [{ provide: WorkerExecutionLauncher, useValue: await scope.get(LocalExecutor) }])
  const library = await scope.get(InlineRunHarness)
  const run = library.run.bind(library)

  expect(await rejected(() => invoke(run, undefined, [input]))).toBe('TypeError: run requires completed definitions')
})
