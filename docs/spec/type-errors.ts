import { Test, run } from 'hanamaru'
import { add } from '../examples/math.ts'
import { createUser, userRepository, mailService } from '../examples/user.ts'

const ready = new Test().target(add)
const suite = ready.it('足す', t => t.args(1, 2).expect(e => [e.result.toBe(3)]))
// @ts-expect-error target is fixed once selected.
ready.target((s: string) => s)
// @ts-expect-error no common configuration after the first case.
suite.mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
// @ts-expect-error suite cannot replace its target.
suite.target((s: string) => s)
// @ts-expect-error suite cannot replace its context.
suite.setup(() => ({ n: 1 }))
// @ts-expect-error incomplete builders cannot produce an executable plan.
ready.plan()
// @ts-expect-error target must precede cases.
new Test().it('未設定', () => {})
// @ts-expect-error arguments must precede expectations.
ready.it('引数なし', t => t.expect(e => [e.result.toBe(3)]))
// @ts-expect-error arguments follow the target signature.
ready.it('引数型', t => t.args('1', 2).expect(e => [e.result.toBe(3)]))
// @ts-expect-error arguments can only be chosen once.
ready.it('二度', t => t.args(1, 2).args(3, 4).expect(e => [e.result.toBe(3)]))
// @ts-expect-error result and error assertions cannot coexist.
ready.it('矛盾', t => t.args(1, 2).expect(e => [e.result.toBe(3), e.error.toThrow('bad')]))
// @ts-expect-error reversed ordering cannot hide contradictory expectations.
ready.it('逆順の矛盾', t => t.args(1, 2).expect(e => [e.error.toThrow('bad'), e.result.toBe(3)]))
// @ts-expect-error at least one assertion is required.
ready.it('空配列', t => t.args(1, 2).expect(() => []))
// @ts-expect-error matcher must be called.
ready.it('未完了', t => t.args(1, 2).expect(e => [e.result]))
// @ts-expect-error the expectation callback is required.
ready.it('検証なし', t => t.args(1, 2).expect())
// @ts-expect-error cannot continue after the terminal value.
ready.it('終端後', t => t.args(1, 2).expect(e => [e.result.toBe(3)]).args(1, 2))
// @ts-expect-error no property is available without setup.
ready.it('ctx', t => t.args(1, 2).expect(e => [e.result.toBe(e.ctx.n)]))
// @ts-expect-error unregistered mocks are unavailable.
ready.it('未登録', t => t.args(1, 2).expect(e => [e.mock(userRepository, 'save').notCalled()]))
const mocked = ready.mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
// @ts-expect-error a different unregistered method is unavailable.
mocked.it('未登録メソッド', t => t.args(1, 2).expect(e => [e.mock(mailService, 'send').notCalled()]))
// @ts-expect-error async behavior is unavailable for synchronous return types.
ready.mock({ add }, 'add', m => m.resolves(3))
// @ts-expect-error a missing optional function is not callable.
new Test().target({} as { run?: () => number }, 'run')
// @ts-expect-error a non-function property cannot be the target.
new Test().target({ label: 'text' }, 'label')
// @ts-expect-error case callbacks must return the terminal value.
ready.it('返し忘れ', t => { t.args(1, 2).expect(e => [e.result.toBe(3)]) })
// @ts-expect-error predicates must return synchronous booleans.
ready.it('非同期述語', t => t.args(1, 2).expect(e => [e.result.toSatisfy(async () => true)]))
// @ts-expect-error the expected value follows the awaited return type.
ready.it('期待値型', t => t.args(1, 2).expect(e => [e.result.toBe('3')]))
// @ts-expect-error mock return values follow the original method.
ready.mock(userRepository, 'save', m => m.resolves({ id: 1 }))
// @ts-expect-error call assertion arguments follow the original method.
mocked.it('呼出引数型', t => t.args(1, 2).expect(e => [e.mock(userRepository, 'save').calledWith(123)]))
// @ts-expect-error a case replacement must preserve the original method's type.
mocked.it('上書き型', t => t.mock(userRepository, 'save', m => m.resolves({ id: 1 })).args(1, 2).expect(e => [e.result.toBe(3)]))
ready.it('ローカル登録', t => t.mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .args(1, 2).expect(e => [e.mock(userRepository, 'save').notCalled()]))
// @ts-expect-error a local registration does not leak into the next case.
  .it('登録の漏出', t => t.args(1, 2).expect(e => [e.mock(userRepository, 'save').notCalled()]))
// @ts-expect-error all case methods freeze common configuration.
ready.todo('未実装').setup(() => ({ n: 1 }))
// @ts-expect-error skip also freezes common configuration.
ready.skip('保留', t => t.args(1, 2).expect(e => [e.result.toBe(3)])).setup(() => ({}))
// @ts-expect-error only also freezes common configuration.
ready.only('集中', t => t.args(1, 2).expect(e => [e.result.toBe(3)])).target(add)
const plan = suite.plan()
// @ts-expect-error the plan structure is readonly.
plan.cases.push({})

// Positive controls retain the original DSL and its ordering.
new Test().target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .mock(mailService, 'send', m => m.resolves(undefined))
  .setup(async () => ({ input: { name: 'Alice' }, expected: { id: 'u1' } }), ctx => { ctx.input.name.toUpperCase() })
  .it('ctxから引数と期待値', t => t.argsFrom(ctx => [ctx.input]).expect(e => [
    e.result.toEqual(e.ctx.expected),
    e.result.toSatisfy(user => user.id === e.ctx.expected.id),
    e.mock(mailService, 'send').calledOnceWith(e.ctx.expected),
  ]))
  .it('ケース内で上書き', t => t
    .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
    .args({ name: 'Alice' }).expect(e => [
      e.error.toBeInstanceOf(Error), e.mock(mailService, 'send').notCalled(),
    ]))
  .it('モックだけなら正常終了を期待', t => t.args({ name: 'Alice' }).expect(e => [
    e.mock(mailService, 'send').calledTimes(1),
  ]))
new Test().setup(() => ({ a: 1 })).target(add)
  .it('setupを先に書ける', t => t.argsFrom(ctx => [ctx.a, 2]).expect(e => [e.result.toBe(3)]))
ready.setup(() => ({ obsolete: 1 })).setup(() => ({ expected: 3 }))
  .it('ケース追加前に設定を選ぶ', t => t.args(1, 2).expect(e => [e.result.toBe(e.ctx.expected)]))
ready.mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .mock(userRepository, 'save', m => m.resolves({ id: 'u2' }))
  .it('同じ登録先は後勝ち', t => t.args(1, 2).expect(e => [e.mock(userRepository, 'save').notCalled()]))
ready.it('argsの後にもmockを書ける', t => t.args(1, 2)
  .mock(userRepository, 'save', m => m.callsFake(async () => ({ id: 'u1' })))
  .expect(e => [e.result.toBe(3), e.mock(userRepository, 'save').notCalled()]))
ready.it('例外も同じexpect', t => t.args(1, 2).expect(e => [e.error.toThrow('bad')]))
run(plan)

// Structural typing cannot distinguish a different object with the same shape.
const shadowRepository: typeof userRepository = { async save() { return { id: 'shadow' } } }
mocked.it('参照の同一性は実行時に検査', t => t.args(1, 2).expect(e => [
  e.mock(shadowRepository, 'save').notCalled(),
]))
