import { Test, defineConfig, middleware, run } from 'hanamaru'
import type { AttemptResult, CaseResult, DiagnosticValue, Failure, SourceLocation } from 'hanamaru'
import { add } from '../examples/math.ts'

defineConfig({
  include: ['**/*.{test,spec}.ts'],
  exclude: ['**/node_modules/**', '**/dist/**'],
  reporter: 'pretty',
  collectionTimeout: 120_000,
  shutdownGrace: 5_000,
})

const rows = [{ a: 1, b: 2, expected: 3 }]
const ready = new Test().retry(2).target(add).timeout(2_000).retry(1)
const suite = ready.each('足す', rows, (t, row) => t
  .timeout(500).args(row.a, row.b).retry(0)
  .expect(e => [e.result.toBe(row.expected)]))
ready.each(row => `${row.a} + ${row.b}`, rows, (t, row) => t.args(row.a, row.b).expect(e => [e.result.toBe(row.expected)]))
ready.each('タプル', [[1, 2, 3], [2, 3, 5]], (t, row) => t.args(row[0], row[1]).expect(e => [e.result.toBe(row[2])]))
ready.use(middleware(async (_, next) => next({ expected: 3 }))).each('ctx', rows, (t, row) => t.args(row.a, row.b).expect(e => [e.result.toBe(e.ctx.expected)]))
suite.it('通常ケースも追加する', t => t.args(1, 2).expect(e => [e.result.toBe(3)]))
new Test().timeout(5_000).retry(2).group(suite)
run(suite.plan(), { failOnFlaky: true })
// @ts-expect-error each requires a target.
new Test().each('未設定', rows, () => {})
// @ts-expect-error each is one complete call, not a prefix for it.
ready.each(rows)
// @ts-expect-error names derived from rows must be strings.
ready.each(row => row.a, rows, (t, row) => t.args(row.a, row.b).expect(e => [e.result.toBe(3)]))
// @ts-expect-error name callbacks use the inferred row type.
ready.each(row => row.missing, rows, (t, row) => t.args(row.a, row.b).expect(e => [e.result.toBe(3)]))
// @ts-expect-error input fields cannot change the target signature.
ready.each('引数型', [{ a: '1', b: 2 }], (t, row) => t.args(row.a, row.b).expect(e => [e.result.toBe(3)]))
// @ts-expect-error expected fields cannot change the awaited result type.
ready.each('期待値型', [{ a: 1, b: 2, expected: '3' }], (t, row) => t.args(row.a, row.b).expect(e => [e.result.toBe(row.expected)]))
// @ts-expect-error each bodies must finish the case.
ready.each('未完成', rows, (t, row) => t.args(row.a, row.b))
// @ts-expect-error definition callbacks are synchronous.
ready.each('非同期', rows, async (t, row) => t.args(row.a, row.b).expect(e => [e.result.toBe(3)]))
// @ts-expect-error each freezes common context.
suite.use(middleware(async (_, next) => next({ x: 1 })))
// @ts-expect-error each freezes common timeout.
suite.timeout(100)
// @ts-expect-error it freezes common retry.
ready.todo('後で').retry(2)
// @ts-expect-error group freezes common settings.
new Test().group(suite).timeout(100)
// @ts-expect-error timeout is a numeric duration.
ready.timeout('100')
// @ts-expect-error retry is a numeric count.
ready.retry('2')
// @ts-expect-error case settings are fixed once assertions start.
ready.it('検証後の設定', t => t.args(1, 2).expect(e => [e.result.toBe(3)]).retry(2))
// @ts-expect-error settings do not insert fields into user context.
ready.it('予約ctxなし', t => t.args(1, 2).expect(e => [e.result.toBe(e.ctx.timeout)]))
// @ts-expect-error signal is not a public runner option.
run(suite.plan(), { signal: {} })

const api = { async fetch(id: string) { return { id } } }
ready.mock(api, 'fetch', m => m.rejectsOnce(new Error('temporary')).resolvesOnce({ id: 'u1' }).resolves({ id: 'u2' }))
ready.mock({ add }, 'add', m => m.returnsOnce(1).throwsOnce(undefined).callsFakeOnce((a, b) => a + b).returns(3))
// @ts-expect-error a sequence must define its persistent behavior.
ready.mock(api, 'fetch', m => m.resolvesOnce({ id: 'u1' }))
// @ts-expect-error an empty behavior builder is not a behavior.
ready.mock(api, 'fetch', m => m)
// @ts-expect-error once values preserve the original return type.
ready.mock(api, 'fetch', m => m.resolvesOnce({ id: 1 }).resolves({ id: 'u1' }))
// @ts-expect-error synchronous methods cannot reject once.
ready.mock({ add }, 'add', m => m.rejectsOnce('error').returns(3))
// @ts-expect-error synchronous methods cannot resolve once.
ready.mock({ add }, 'add', m => m.resolvesOnce(3).returns(3))
// @ts-expect-error fake parameters retain the method signature.
ready.mock(api, 'fetch', m => m.callsFakeOnce(async (n: number) => ({ id: String(n) })).resolves({ id: 'u1' }))
// @ts-expect-error terminal behavior cannot be extended into another sequence.
ready.mock(api, 'fetch', m => m.resolves({ id: 'u1' }).rejectsOnce('error'))
const observed = ready.it('2回目', t => t.args(1, 2).expectCalls(call => [call(api, 'fetch').calledNthWith(2, 'u1')]))
// @ts-expect-error nth arguments follow the original method.
ready.it('nth引数', t => t.args(1, 2).expectCalls(call => [call(api, 'fetch').calledNthWith(2, 123)]))
// @ts-expect-error nth requires its index.
ready.it('nth位置', t => t.args(1, 2).expectCalls(call => [call(api, 'fetch').calledNthWith('u1')]))

for (const c of observed.plan().cases) {
  const origin: SourceLocation = c.origin
  const timeout: number | undefined = c.config.timeout
  void [origin, timeout]
  // @ts-expect-error source locations are readonly.
  c.origin.line = 1
  if (c.mode === 'todo') continue
  for (const a of c.calls) {
    if (a.check.matcher === 'calledNthWith') {
      const n: number = a.check.n
      void n
    }
  }
}
declare const result: CaseResult
const timeout: number = result.config.timeout
for (const attempt of result.attempts) {
  const index: number = attempt.attempt
  for (const a of attempt.assertions) {
    if (a.status === 'not-evaluated') {
      const reason: string = a.reason
      void reason
    } else {
      const actual: DiagnosticValue = a.actual
      void actual
    }
  }
  void index
}
const failure = {
  kind: 'assertion', phase: 'assertion', message: 'called twice',
  assertion: { source: 'expectCalls', index: 0, subject: 'call', key: 'fetch', matcher: 'calledOnceWith' },
  expected: { kind: 'number', value: 1 }, actual: { kind: 'number', value: 2 },
} satisfies Failure
const thrownUndefined = { kind: 'outcome', phase: 'target', message: 'unexpected throw', expected: 'return', actual: { kind: 'throw', value: { kind: 'undefined' } } } satisfies Failure
// @ts-expect-error assertion failures must retain expected and actual.
const incompleteFailure: Failure = { kind: 'assertion', phase: 'assertion', message: 'bad', assertion: failure.assertion }
// @ts-expect-error a location cannot omit its column.
const incompleteOrigin: SourceLocation = { file: '/tests/add.test.ts', line: 1 }
// @ts-expect-error diagnostic values distinguish BigInt from strings and numbers.
const invalidDiagnostic: DiagnosticValue = { kind: 'bigint', value: 1n }
// @ts-expect-error result attempts cannot be appended by consumers.
result.attempts.push({})
void [timeout, failure, thrownUndefined, incompleteFailure, incompleteOrigin, invalidDiagnostic]

// @ts-expect-error failures belong to individual attempts, never the case aggregate.
result.failures
const allFailures: readonly Failure[] = result.attempts.flatMap(attempt => attempt.failures)
void allFailures

// @ts-expect-error case status is derived from attempts or its non-execution reason.
result.status
// @ts-expect-error flaky is derived from the attempt history.
result.flaky

const caseInfo = {
  name: '足す', origin: { file: '/tests/math.test.ts', line: 1, column: 1 },
  path: [0, 0], row: null, config: { timeout: 500, retry: 2 }, durationMs: 0,
} as const
declare const attempt: AttemptResult
const executed: CaseResult = { ...caseInfo, attempts: [attempt] }
const skipped: CaseResult = { ...caseInfo, attempts: [], notRun: 'skipped' }
const todo: CaseResult = { ...caseInfo, attempts: [], notRun: 'todo' }
const cancelled: CaseResult = { ...caseInfo, attempts: [], notRun: 'cancelled' }
// @ts-expect-error a case with no attempts must explain why it was not run.
const unexplained: CaseResult = { ...caseInfo, attempts: [] }
// @ts-expect-error a case with attempts cannot also claim it was not run.
const contradictory: CaseResult = { ...caseInfo, attempts: [attempt], notRun: 'skipped' }
// @ts-expect-error a passed case must have an actual attempt.
const inventedSuccess: CaseResult = { ...caseInfo, attempts: [], notRun: 'passed' }
if (result.notRun !== undefined) {
  const empty: readonly [] = result.attempts
  void empty
} else {
  const first: AttemptResult = result.attempts[0]
  void first
}
void [executed, skipped, todo, cancelled, unexplained, contradictory, inventedSuccess]
