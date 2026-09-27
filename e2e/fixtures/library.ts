import assert from 'node:assert/strict'
import { Test, middleware, run } from 'hanamaru'
import { contracts, lifecycle, service, originalRead } from './contracts.test.ts'

assert.deepEqual(lifecycle, [])
const blueprint = contracts.blueprint()
assert.equal(blueprint.kind, 'definition')
assert.equal(blueprint.children[0].kind, 'group')
assert.equal(blueprint.children[0].name, 'contracts')
assert.deepEqual(lifecycle, [])
const result = await run(contracts)
assert.equal(result.status, 'passed')
const group = result.tests[0].children[0].result
assert.equal(group.middleware.status, 'passed')
const cases = group.children.flatMap((child) => child.result.cases)
assert.equal(cases.length, 6)
for (const item of cases) {
  assert.ok(item.origin.file.endsWith('contracts.test.ts'))
  assert.ok(item.origin.line > 0)
  assert.ok(item.origin.column > 0)
  if (item.notRun) {
    assert.deepEqual(item.attempts, [])
    assert.equal(item.durationMs, 0)
  } else {
    assert.equal(item.attempts[0].status, 'passed')
    assert.equal(item.attempts[0].cleanup, 'complete')
  }
}
assert.deepEqual(
  cases.slice(2, 4).map((item) => item.notRun),
  ['skipped', 'todo'],
)
assert.deepEqual(
  cases.slice(4).map((item) => item.row.index),
  [0, 1],
)
assert.deepEqual(lifecycle, [
  'group open',
  'attempt open',
  'attempt close',
  'attempt open',
  'attempt close',
  'group close',
])
assert.equal(service.read, originalRead)
assert.equal(service.read(3), 6)

const shared = { count: 0 }
let capturedContext: { shared: typeof shared; answer: number }
const contextual = new Test()
  .use(middleware(async (_, next) => next({ shared, answer: 42 })))
  .target((resource: typeof shared) => ++resource.count)
  .it('context', (t) =>
    t
      .argsFrom((ctx) => {
        assert.equal(ctx.shared, shared)
        capturedContext = ctx
        return [ctx.shared]
      })
      .expect((e) => [e.result.toBe(1)]),
  )
assert.equal((await run(contextual)).status, 'passed')
assert.equal(shared.count, 1)
for (const mutate of [
  () => Reflect.set(capturedContext, 'answer', 0),
  () => Reflect.deleteProperty(capturedContext, 'answer'),
  () => Reflect.defineProperty(capturedContext, 'answer', { value: 0 }),
]) {
  // Both a false return and an exception may reject a write; verify its effect outside the promise.
  await Promise.allSettled([Promise.resolve().then(mutate)])
  assert.equal(capturedContext.answer, 42)
  assert.equal(capturedContext.shared, shared)
}

const pattern = /boom/g
pattern.lastIndex = 2
const errors = new Test()
  .target((value: Error | { message: string }) => Promise.reject(value))
  .it('Error', (t) => t.args(new Error('boom')).expect((e) => [e.error.toThrow(pattern)]))
  .it('non-Error', (t) => t.args({ message: 'boom' }).expect((e) => [e.error.toThrow('boom')]))
const errorResult = await run(errors)
assert.equal(errorResult.status, 'failed')
assert.deepEqual(
  errorResult.tests[0].cases.map((item) => item.attempts[0].status),
  ['passed', 'failed'],
)
assert.equal(pattern.lastIndex, 2)
assert.equal(errorResult.tests[0].cases[1].attempts[0].failures[0].kind, 'assertion')

const mismatch = new Test()
  .target(() => ({ value: 1 }))
  .it('mismatch', (t) => t.args().expect((e) => [e.result.toMatchObject({ value: 2 })]))
const mismatchResult = await run(mismatch)
assert.equal(mismatchResult.status, 'failed')
const failure = mismatchResult.tests[0].cases[0].attempts[0].failures[0]
assert.equal(failure.kind, 'assertion')
assert.equal(failure.assertion.matcher, 'toMatchObject')

const diagnostic = new Test()
  .target(() => [new Date('2020-01-01'), /a/g, new Map([[1, 2]])])
  .it('diagnostic', (t) => t.args().expect((e) => [e.result.toSatisfy(() => true)]))
const [date, regexp, map] = (await run(diagnostic)).tests[0].cases[0].attempts[0].outcome.value.items
assert.equal(date.value, '2020-01-01T00:00:00.000Z')
assert.equal(regexp.source, 'a')
assert.equal(regexp.flags, 'g')
assert.deepEqual(map.entries, [
  [
    { kind: 'number', value: 1 },
    { kind: 'number', value: 2 },
  ],
])

const selected = new Test().target(() => 1).only('only', (t) => t.args().expect((e) => [e.result.toBe(1)]))
assert.equal((await run(selected)).status, 'passed')
await assert.rejects(run(selected, { forbidOnly: true }), /only is forbidden/)

console.log(
  JSON.stringify({ status: 'passed', runtime: process.versions.bun ? 'bun' : process.versions.deno ? 'deno' : 'node' }),
)
