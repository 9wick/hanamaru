import { expect, test } from 'vite-plus/test'
import * as v from 'valibot'
import { runResultSchema } from '../../domain/result/schemas.js'
import type { Value } from '../../foundation/value.js'
import type {
  CallAssertion,
  CallMatchers,
  ErrorAssertion,
  ErrorAssertions,
  ResultAssertion,
  RunResult,
  ValueAssertions,
} from '../../index.js'
import { Test, run } from '../../index.js'
import { formatNode } from '../../interfaces/cli/reporters/pretty.js'

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
  readonly assert: (r: Omit<ValueAssertions<ResultValue>, 'not'>) => ResultAssertion<ResultValue>
  readonly matches: boolean
}

// matcher名ごとのアサーション生成をここ一箇所に閉じ込め、matcher名での動的アクセスをなくす。
function resultGroup<E>(
  matcher: string,
  apply: (r: Omit<ValueAssertions<ResultValue>, 'not'>, expected: E) => ResultAssertion<ResultValue>,
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
    for (const negated of [false, true]) {
      const suite = new Test()
        .target((): Value => row.actual)
        .it('matcher', (t) => t.args().expect((e) => [row.assert(negated ? e.result.not : e.result)]))
      const result = await run(suite)
      expectOutcome(result, negated ? !row.matches : row.matches)
      expect(firstAttempt(result).assertions[0]?.assertion).toMatchObject(
        negated ? { subject: 'result', negated: true } : { subject: 'result' },
      )
    }
  }
})

interface ErrorRow {
  readonly assert: (a: Omit<ErrorAssertions, 'not'>) => ErrorAssertion
  readonly matches: boolean
}

function errorGroup<E>(
  matcher: string,
  apply: (a: Omit<ErrorAssertions, 'not'>, expected: E) => ErrorAssertion,
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
    for (const negated of [false, true]) {
      const suite = new Test()
        .target(() => Promise.reject(actual))
        .it('matcher', (t) => t.args().expect((e) => [row.assert(negated ? e.error.not : e.error)]))
      const result = await run(suite)
      expectOutcome(result, negated ? !row.matches : row.matches)
      expect(firstAttempt(result).assertions[0]?.assertion).toMatchObject(
        negated ? { subject: 'error', negated: true } : { subject: 'error' },
      )
    }
  }
})

test('not leaves positive assertions independent and identifies failures in the report', async () => {
  const result = await run(
    new Test()
      .target(() => 1)
      .it('negation', (t) =>
        t.args().expect((e) => {
          const negative = e.result.not.toBe(1)
          return [negative, e.result.toBe(1), e.result.not.toBe(2)]
        }),
      ),
  )
  const attempt = firstAttempt(result)
  expect(attempt.assertions.map((a) => a.status)).toEqual(['failed', 'passed', 'passed'])
  expect(attempt.assertions[1]?.assertion).not.toHaveProperty('negated')
  expect(attempt.failures).toMatchObject([
    { kind: 'assertion', assertion: { matcher: 'toBe', negated: true }, expected: { value: 1 }, actual: { value: 1 } },
  ])
  expect(formatNode(v.parse(runResultSchema, result).tests[0]).join('\n')).toContain('result.not.toBe')
})

test('not does not turn predicate or comparison exceptions into passing assertions', async () => {
  const value = {
    get value(): number {
      throw new Error('getter failed')
    },
  }
  const result = await run(
    new Test()
      .target(() => value)
      .it('exceptions', (t) =>
        t.args().expect((e) => [
          e.result.not.toSatisfy(() => {
            throw new Error('predicate failed')
          }),
          e.result.not.toEqual({ value: 1 }),
        ]),
      ),
  )
  const attempt = firstAttempt(result)
  expect(result.status).toBe('failed')
  expect(attempt.assertions.map((a) => a.status)).toEqual(['failed', 'failed'])
  expect(attempt.failures).toMatchObject([
    { kind: 'execution', phase: 'assertion', assertion: { negated: true } },
    { kind: 'execution', phase: 'assertion', assertion: { negated: true } },
  ])
})

test('not keeps the required target outcome and does not evaluate mismatched predicates', async () => {
  let evaluated = 0
  const returned = await run(
    new Test()
      .target(() => 1)
      .it('return', (t) =>
        t.args().expect((e) => [
          e.error.not.toSatisfy(() => {
            evaluated++
            return false
          }),
        ]),
      ),
  )
  const thrown = await run(
    new Test()
      .target((): number => {
        throw new Error('boom')
      })
      .it('throw', (t) =>
        t.args().expect((e) => [
          e.result.not.toSatisfy(() => {
            evaluated++
            return false
          }),
        ]),
      ),
  )
  for (const result of [returned, thrown]) {
    expect(result.status).toBe('failed')
    expect(firstAttempt(result).failures[0]?.kind).toBe('outcome')
    expect(firstAttempt(result).assertions[0]).toMatchObject({ status: 'not-evaluated', assertion: { negated: true } })
  }
  expect(evaluated).toBe(0)
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
