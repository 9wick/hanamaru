import { createTestTarget } from '@zeltjs/testing/vitest'
import { expect, test } from 'vite-plus/test'
import { Test, middleware } from '../../../../../src/index.js'
import type { ItBuilder, ItDone, RunResult, TestResult } from '../../../../../src/index.js'
import type { RunInput } from './run.js'
import { LibraryRun } from './run.js'
import { ValueComparison } from '../../infrastructure/comparison.js'
import { LocalExecutor } from '../../infrastructure/execution/local.js'
import { invoke } from '../../domain/execution/javascript.js'
import type { Value } from '../../domain/execution/javascript.js'

function testResult(result: RunResult): TestResult {
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  return node
}

const lifecycle: string[] = []
const service = {
  read(value: number) {
    return value * 2
  },
}
const originalRead = service.read

const operations = new Test<{ label: string }>()
  .use(
    middleware(async (_, next) => {
      lifecycle.push('attempt open')
      try {
        return await next({ input: 3 })
      } finally {
        lifecycle.push('attempt close')
      }
    }),
  )
  .mock(service, 'read', (m) => m.returnsOnce(7).returns(8))
  .target((input: number) => [service.read(input), service.read(input + 1)])
  .it('mock sequence', (t) =>
    t
      .argsFrom((ctx) => [ctx.input])
      .expect((e) => [e.result.toEqual([7, 8]), e.result.toSatisfy(() => e.ctx.label === 'shared')])
      .expectCalls((call) => [call(service, 'read').calledTimes(2), call(service, 'read').calledNthWith(2, 4)]),
  )
  .it('case override', (t) =>
    t
      .mock(service, 'read', (m) => m.returns(9))
      .argsFrom((ctx) => [ctx.input])
      .expect((e) => [e.result.toEqual([9, 9])])
      .expectCalls((call) => [call(service, 'read').calledNthWith(1, 3)]),
  )
  .skip('skipped', (t) => t.args(1).expect((e) => [e.result.toEqual([])]))
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

test('library execution preserves lifecycle, mocks, rows, skipped cases and declaration origins', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
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
    expect(item.origin.file).toMatch(/run\.test\.ts$/)
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
  expect(service.read).toBe(originalRead)
  expect(service.read(3)).toBe(6)
})

test('library contexts reject container writes while retaining shared object identity', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
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

test('library error expectations retain regex state and distinguish non-Error outcomes', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const pattern = /boom/g
  pattern.lastIndex = 2
  const specification = new Test()
    .target((value: Error | { message: string }) => Promise.reject(value))
    .it('Error', (t) => t.args(new Error('boom')).expect((e) => [e.error.toThrow(pattern)]))
    .it('non-Error', (t) => t.args({ message: 'boom' }).expect((e) => [e.error.toThrow('boom')]))
  const result = await library.run(specification)
  expect(result.status).toBe('failed')
  expect(testResult(result).cases.map((item) => item.attempts[0]?.status)).toEqual(['passed', 'failed'])
  expect(pattern.lastIndex).toBe(2)
  expect(testResult(result).cases[1].attempts[0]?.failures[0]?.kind).toBe('assertion')
})

test('library mismatches identify the assertion matcher', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const specification = new Test()
    .target(() => ({ value: 1 }))
    .it('mismatch', (t) => t.args().expect((e) => [e.result.toMatchObject({ value: 2 })]))
  const result = await library.run(specification)
  expect(result.status).toBe('failed')
  const failure = testResult(result).cases[0].attempts[0]?.failures[0]
  expect.assert(failure?.kind === 'assertion')
  expect(failure.assertion.matcher).toBe('toMatchObject')
})

test('library results encode dates, regexps and maps', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const specification = new Test()
    .target(() => [new Date('2020-01-01'), /a/g, new Map([[1, 2]])])
    .it('diagnostic', (t) => t.args().expect((e) => [e.result.toSatisfy(() => true)]))
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
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
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
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
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
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  expect(await rejected(() => invoke(run, undefined, [input]))).toBe('TypeError: run requires completed definitions')
})
