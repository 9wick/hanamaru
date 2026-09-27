import { expect, test } from 'vite-plus/test'
import type {
  CallAssertion,
  CallMatchers,
  ErrorAssertion,
  ErrorAssertions,
  ResultAssertion,
  RunResult,
  ValueAssertions,
} from './index.js'
import type { Value } from './value.js'
import { Test, run } from './index.js'

type ResultValue = Awaited<Value>
type ReadMethod = (value: number) => number

function firstAttempt(result: RunResult) {
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  const attempt = node.cases[0].attempts[0]
  expect.assert(attempt !== undefined)
  return attempt
}
// 期待するstatusは真偽表にハードコードしたmatchesから引く。Vitest側で再計算しない。
function expectOutcome(result: RunResult, matches: boolean) {
  const attempt = firstAttempt(result)
  expect(result.status).toBe(matches ? 'passed' : 'failed')
  expect(attempt.assertions[0]?.status).toBe(matches ? 'passed' : 'failed')
  if (!matches) expect(attempt.failures[0]?.kind).toBe('assertion')
}

interface ResultRow {
  readonly actual: Value
  readonly assert: (r: ValueAssertions<ResultValue>) => ResultAssertion<ResultValue>
  readonly matches: boolean
}
// matcher名ごとのアサーション生成をここ一箇所に閉じ込め、matcher名での動的アクセスをなくす。
function resultGroup<E>(
  matcher: string,
  apply: (r: ValueAssertions<ResultValue>, expected: E) => ResultAssertion<ResultValue>,
  cases: readonly (readonly [actual: Value, expected: E, matches: boolean])[],
) {
  const rows: readonly ResultRow[] = cases.map(([actual, expected, matches]) => ({
    actual,
    assert: (r) => apply(r, expected),
    matches,
  }))
  return { matcher, rows }
}

const resultGroups = [
  resultGroup('toBe', (r, expected: Value) => r.toBe(expected), [
    [1, 1, true],
    [1, 2, false],
    [NaN, NaN, true],
    [0, -0, false],
  ]),
  resultGroup('toEqual', (r, expected: Value) => r.toEqual(expected), [
    [{ value: 1 }, { value: 1 }, true],
    [{ value: 1 }, { value: 2 }, false],
  ]),
  resultGroup('toMatchObject', (r, expected: object) => r.toMatchObject(expected), [
    [{ value: 1, extra: 2 }, { value: 1 }, true],
    [{ value: 1 }, { value: 2 }, false],
    [{ value: 1 }, { missing: undefined }, false],
    [{ value: undefined }, { value: undefined }, true],
  ]),
  resultGroup('toSatisfy', (r, expected: (value: ResultValue) => boolean) => r.toSatisfy(expected), [
    [2, (value) => value === 2, true],
    [2, (value) => value === 3, false],
  ]),
]

test.for(resultGroups)('result.$matcher distinguishes matches from mismatches', async ({ rows }) => {
  for (const row of rows) {
    const suite = new Test()
      .target((): Value => row.actual)
      .it('matcher', (t) => t.args().expect((e) => [row.assert(e.result)]))
    expectOutcome(await run(suite), row.matches)
  }
})

interface ErrorRow {
  readonly assert: (a: ErrorAssertions) => ErrorAssertion
  readonly matches: boolean
}
function errorGroup<E>(
  matcher: string,
  apply: (a: ErrorAssertions, expected: E) => ErrorAssertion,
  actual: Value,
  matching: E,
  mismatching: E,
) {
  const rows: readonly ErrorRow[] = [
    { assert: (a) => apply(a, matching), matches: true },
    { assert: (a) => apply(a, mismatching), matches: false },
  ]
  return { matcher, actual, rows }
}

const errorGroups = [
  errorGroup(
    'toBeInstanceOf',
    (a, ctor: new (...args: never[]) => object) => a.toBeInstanceOf(ctor),
    new TypeError('boom'),
    Error,
    RangeError,
  ),
  errorGroup('toThrow', (a, message: string | RegExp) => a.toThrow(message), new Error('boom'), 'oo', 'different'),
  errorGroup(
    'toMatchObject',
    (a, expected: Record<string, Value>) => a.toMatchObject(expected),
    { code: 'ENOENT', detail: 1 },
    { code: 'ENOENT' },
    { code: 'EIO' },
  ),
  errorGroup(
    'toSatisfy',
    (a, predicate: (error: Value) => boolean) => a.toSatisfy(predicate),
    undefined,
    (value) => value === undefined,
    (value) => value !== undefined,
  ),
]

test.for(errorGroups)('error.$matcher distinguishes matches from mismatches', async ({ actual, rows }) => {
  for (const row of rows) {
    const suite = new Test()
      .target(() => Promise.reject(actual))
      .it('matcher', (t) => t.args().expect((e) => [row.assert(e.error)]))
    expectOutcome(await run(suite), row.matches)
  }
})

interface CallRow {
  readonly calls: readonly (readonly [number])[]
  readonly assert: (m: CallMatchers<ReadMethod>) => CallAssertion
  readonly matches: boolean
}
function callGroup<A>(
  matcher: string,
  apply: (m: CallMatchers<ReadMethod>, args: A) => CallAssertion,
  cases: readonly (readonly [calls: readonly (readonly [number])[], args: A, matches: boolean])[],
) {
  const rows: readonly CallRow[] = cases.map(([calls, args, matches]) => ({
    calls,
    assert: (m) => apply(m, args),
    matches,
  }))
  return { matcher, rows }
}

const callGroups = [
  callGroup('calledTimes', (m, [count]: readonly [number]) => m.calledTimes(count), [
    [[], [0], true],
    [[[1], [2]], [2], true],
    [[[1], [2]], [1], false],
  ]),
  callGroup<readonly []>('notCalled', (m) => m.notCalled(), [
    [[], [], true],
    [[[1]], [], false],
  ]),
  callGroup('calledWith', (m, args: readonly [number]) => m.calledWith(...args), [
    [[[1], [2]], [2], true],
    [[[1], [2]], [3], false],
  ]),
  callGroup('calledOnceWith', (m, args: readonly [number]) => m.calledOnceWith(...args), [
    [[[1]], [1], true],
    [[[1]], [2], false],
    [[[1], [1]], [1], false],
  ]),
  callGroup('calledNthWith', (m, [n, value]: readonly [number, number]) => m.calledNthWith(n, value), [
    [[[1], [2]], [2, 2], true],
    [[[1], [2]], [1, 2], false],
    [[[1], [2]], [3, 2], false],
  ]),
]

test.for(callGroups)('$matcher checks call counts and arguments', async ({ rows }) => {
  for (const row of rows) {
    const service = {
      read(value: number) {
        return value
      },
    }
    const original = service.read
    const suite = new Test()
      .target(() => {
        for (const values of row.calls) service.read(...values)
      })
      .it('calls', (t) => t.args().expectCalls((call) => [row.assert(call(service, 'read'))]))
    expectOutcome(await run(suite), row.matches)
    expect(service.read).toBe(original)
  }
})
