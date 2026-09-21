import { Test, run } from 'hanamaru'
import { add } from '../examples/math.ts'
import { userRepository } from '../examples/user.ts'

const ready = new Test().target(add)
const suite = ready.it('足す', t => t.args(1, 2).expect(e => [e.result.toBe(3)]))
// @ts-expect-error target is fixed once selected.
ready.target((s: string) => s)
// @ts-expect-error setup precedes target.
ready.setup(() => ({ n: 1 }))
// @ts-expect-error no configuration after the first case.
suite.mock('save', userRepository, 'save', m => m.resolves({ id: 'u1', name: 'a' }))
// @ts-expect-error suite cannot replace its target.
suite.target((s: string) => s)
// @ts-expect-error suite cannot replace its context.
suite.setup(() => ({ n: 1 }))
// @ts-expect-error setup is called once.
new Test().setup(() => ({ n: 1 })).setup(() => ({ other: 2 }))
// @ts-expect-error incomplete builders cannot be inspected.
ready.plan()
// @ts-expect-error root cannot add cases before choosing target.
new Test().it('未設定', () => {})
// @ts-expect-error arguments are required before expectation.
ready.it('引数なし', t => t.expect())
// @ts-expect-error argument types follow target.
ready.it('型違い', t => t.args('1', 2).expect())
// @ts-expect-error arguments can only be chosen once.
ready.it('二度', t => t.args(1, 2).args(3, 4).expect())
// @ts-expect-error success has no error matcher.
ready.it('矛盾', t => t.args(1, 2).expect(e => [e.error.toThrow('bad')]))
// @ts-expect-error failure has no result matcher.
ready.it('矛盾', t => t.args(1, 2).expectError(e => [e.result.toBe(3)]))
// @ts-expect-error empty callbacks are accidental; use expect() explicitly.
ready.it('空配列', t => t.args(1, 2).expect(() => []))
// @ts-expect-error matcher must be called.
ready.it('未完了', t => t.args(1, 2).expect(e => [e.result]))
// @ts-expect-error cannot continue after terminal.
ready.it('終端後', t => t.args(1, 2).expect().expectError())
// @ts-expect-error no raw context at definition time.
ready.it('ctx', t => t.args(1, 2).expect(e => [e.result.toBe(e.ctx.n)]))
// @ts-expect-error mocks are referenced by registered names.
ready.it('未登録', t => t.args(1, 2).expect(e => [e.mock('save').notCalled()]))
const mocked = ready.mock('save', userRepository, 'save', m => m.resolves({ id: 'u1', name: 'a' }))
// @ts-expect-error duplicate name; override is explicit within a case.
mocked.mock('save', userRepository, 'save', m => m.resolves({ id: 'u1', name: 'a' }))
// @ts-expect-error override cannot invent a dependency.
mocked.it('未登録上書き', t => t.override('send', () => {}).args(1, 2).expect())
// @ts-expect-error async behavior is not available for sync return types.
ready.mock('add', { add }, 'add', m => m.resolves(3))
// @ts-expect-error optional function is not guaranteed callable.
new Test().target({} as { run?: () => number }, 'run')
// @ts-expect-error missing return in the case callback.
ready.it('返し忘れ', t => { t.args(1, 2).expect() })

// Positive controls.
ready.it('正常終了のみ', t => t.args(1, 2).expect())
ready.it('例外のみ', t => t.args(1, 2).expectError())
new Test().setup(async () => ({ a: 1, expected: 3 }))
  .target(add)
  .it('遅延値', t => t.argsFrom('fixtureのaと2', c => [c.a, 2]).expect(e => [
    e.result.toEqualFrom('fixtureの期待値', c => c.expected),
    e.result.toSatisfy('期待値と等しい', (n, c) => n === c.expected),
  ]))
new Test().setup(() => ({ repo: userRepository }))
  .target(add)
  .mockFrom('save', c => c.repo, 'save', m => m.resolves({ id: 'u1', name: 'a' }))
  .it('名前で参照', t => t.args(1, 2).expect(e => [e.mock('save').notCalled()]))
run(suite.plan())

const unionName = '' as 'save' | 'send'
// @ts-expect-error one runtime name must not register a union of names.
ready.mock(unionName, userRepository, 'save', m => m.resolves({ id: 'u1', name: 'a' }))
const dynamicName = '' as string
// @ts-expect-error a dynamic name cannot guarantee registration.
ready.mock(dynamicName, userRepository, 'save', m => m.resolves({ id: 'u1', name: 'a' }))
ready.it('ローカル登録', t => t.mock('save', userRepository, 'save', m => m.resolves({ id: 'u1', name: 'a' }))
  .args(1, 2).expect(e => [e.mock('save').notCalled()]))
// @ts-expect-error another case cannot see the previous case's registration.
  .it('登録の漏出', t => t.args(1, 2).expect(e => [e.mock('save').notCalled()]))
// @ts-expect-error predicates must be synchronous booleans.
ready.it('非同期述語', t => t.args(1, 2).expect(e => [e.result.toSatisfy('条件', async () => true)]))
const plan = suite.plan()
// @ts-expect-error plan structure is readonly.
plan.cases.push({})
for (const c of plan.cases) {
  if (c.mode !== 'todo' && c.outcome.kind === 'return') {
    for (const a of c.outcome.assertions) {
      // @ts-expect-error successful outcomes cannot contain error assertions.
      const impossible: 'error' = a.subject
    }
  }
}

// @ts-expect-error mock return values follow the original method.
ready.mock('bad-return', userRepository, 'save', m => m.resolves({ id: 1, name: 'a' }))
// @ts-expect-error mock assertion arguments follow the registered method.
mocked.it('呼出引数型', t => t.args(1, 2).expect(e => [e.mock('save').calledWith(123)]))
// @ts-expect-error return expectations follow target's awaited return type.
ready.it('期待値型', t => t.args(1, 2).expect(e => [e.result.toBe('3')]))
// @ts-expect-error override cannot change the original method's return type.
mocked.it('上書き型', t => t.override('save', m => m.resolves({ id: 1, name: 'a' })).args(1, 2).expect())
