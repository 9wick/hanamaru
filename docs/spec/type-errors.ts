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
// @ts-expect-error arguments stay fixed after expectations begin.
ready.it('終端後', t => t.args(1, 2).expect(e => [e.result.toBe(3)]).args(1, 2))
// @ts-expect-error no property is available without setup.
ready.it('ctx', t => t.args(1, 2).expect(e => [e.result.toBe(e.ctx.n)]))
const mocked = ready.mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
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
mocked.it('呼出引数型', t => t.args(1, 2).expectCalls(call => [call(userRepository, 'save').calledWith(123)]))
// @ts-expect-error a case replacement must preserve the original method's type.
mocked.it('上書き型', t => t.mock(userRepository, 'save', m => m.resolves({ id: 1 })).args(1, 2).expect(e => [e.result.toBe(3)]))
// @ts-expect-error all case methods freeze common configuration.
ready.todo('未実装').setup(() => ({ n: 1 }))
// @ts-expect-error skip also freezes common configuration.
ready.skip('保留', t => t.args(1, 2).expect(e => [e.result.toBe(3)])).setup(() => ({}))
// @ts-expect-error only also freezes common configuration.
ready.only('集中', t => t.args(1, 2).expect(e => [e.result.toBe(3)])).target(add)
const plan = suite.plan()
// @ts-expect-error the plan structure is readonly.
plan.cases.push({})

// Call expectations have no mock-registration prerequisite.
ready.it('登録なし', t => t.args(1, 2).expectCalls(call => [
  call(userRepository, 'save').notCalled(), call(mailService, 'send').notCalled(),
]))
ready.it('結果と呼び出し', t => t.args(1, 2)
  .expect(e => [e.result.toBe(3)])
  .expectCalls(call => [call(mailService, 'send').notCalled()]))
ready.it('順序を入れ替える', t => t.args(1, 2)
  .expectCalls(call => [call(mailService, 'send').notCalled()])
  .expect(e => [e.result.toBe(3)]))
mocked.it('同じメソッドに複数条件', t => t.args(1, 2).expectCalls(call => [
  call(userRepository, 'save').calledTimes(0), call(userRepository, 'save').notCalled(),
]))
// @ts-expect-error a non-function property is not observable.
ready.it('非メソッド', t => t.args(1, 2).expectCalls(call => [call({ label: 'a' }, 'label').notCalled()]))
// @ts-expect-error nonexistent keys are unavailable.
ready.it('キー違い', t => t.args(1, 2).expectCalls(call => [call(mailService, 'save').notCalled()]))
// @ts-expect-error call arguments follow the original method.
ready.it('引数型', t => t.args(1, 2).expectCalls(call => [call(mailService, 'send').calledOnceWith({ id: 1 })]))
// @ts-expect-error observation cannot omit its matcher.
ready.it('呼び忘れ', t => t.args(1, 2).expectCalls(call => [call(mailService, 'send')]))
// @ts-expect-error at least one call assertion is required.
ready.it('空の呼び出し期待', t => t.args(1, 2).expectCalls(() => []))
// @ts-expect-error the call callback must return descriptors synchronously.
ready.it('非同期の定義', t => t.args(1, 2).expectCalls(async call => [call(mailService, 'send').notCalled()]))
// @ts-expect-error assertions are not arbitrary booleans.
ready.it('boolean', t => t.args(1, 2).expectCalls(() => [true]))
// @ts-expect-error arguments must precede call expectations.
ready.it('引数未定', t => t.expectCalls(call => [call(mailService, 'send').notCalled()]))
// @ts-expect-error calls are declared through their own builder.
ready.it('旧API', t => t.args(1, 2).expect(e => [e.mock(mailService, 'send').notCalled()]))
// @ts-expect-error call builders are not outcome matchers.
ready.it('結果の混入', t => t.args(1, 2).expectCalls(call => [call.result.toBe(3)]))
// @ts-expect-error setup has not run when call assertions are defined.
ready.it('実行時ctx', t => t.args(1, 2).expectCalls(call => [call(call.ctx.mail, 'send').notCalled()]))
// @ts-expect-error outcome expectations are selected once.
ready.it('結果の二重定義', t => t.args(1, 2).expect(e => [e.result.toBe(3)]).expect(e => [e.error.toThrow('bad')]))
// @ts-expect-error call expectations are selected once.
ready.it('呼び出しの二重定義', t => t.args(1, 2).expectCalls(call => [call(mailService, 'send').notCalled()]).expectCalls(() => []))
// @ts-expect-error adding the other expectation must not reopen an existing one.
ready.it('終端の再定義', t => t.args(1, 2).expectCalls(call => [call(mailService, 'send').notCalled()]).expect(e => [e.result.toBe(3)]).expect(e => [e.result.toBe(3)]))
// @ts-expect-error input is fixed once expectations begin.
ready.it('検証後の設定', t => t.args(1, 2).expectCalls(call => [call(mailService, 'send').notCalled()]).mock(userRepository, 'save', m => m.resolves({ id: 'u1' })))
// @ts-expect-error an incomplete case is not a finished test.
ready.it('期待未設定', t => t.args(1, 2))

// Context and mock replacement retain their original spelling.
new Test().target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .setup(async () => ({ input: { name: 'Alice' }, expected: { id: 'u1' } }))
  .it('ctxから引数と期待値', t => t.argsFrom(ctx => [ctx.input]).expect(e => [
    e.result.toEqual(e.ctx.expected),
    e.result.toSatisfy(user => user.id === e.ctx.expected.id),
  ]).expectCalls(call => [call(mailService, 'send').calledOnceWith({ id: 'u1' })]))
  .it('ケース内で上書き', t => t
    .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
    .args({ name: 'Alice' }).expect(e => [e.error.toBeInstanceOf(Error)])
    .expectCalls(call => [call(mailService, 'send').notCalled()]))
  .it('呼び出しだけなら正常終了を期待', t => t.args({ name: 'Alice' })
    .expectCalls(call => [call(mailService, 'send').calledTimes(1)]))
new Test().setup(() => ({ a: 1 })).target(add)
  .it('setupを先に書ける', t => t.argsFrom(ctx => [ctx.a, 2]).expect(e => [e.result.toBe(3)]))
ready.setup(() => ({ a: 1 })).setup(ctx => ({ expected: ctx.a + 2 }))
  .it('ケース追加前に準備を重ねる', t => t.argsFrom(ctx => [ctx.a, 2]).expect(e => [e.result.toBe(e.ctx.expected)]))
ready.mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .mock(userRepository, 'save', m => m.resolves({ id: 'u2' }))
  .it('同じ登録先は後勝ち', t => t.args(1, 2).expectCalls(call => [call(userRepository, 'save').notCalled()]))
ready.it('argsの後にもmockを書ける', t => t.args(1, 2)
  .mock(userRepository, 'save', m => m.callsFake(async () => ({ id: 'u1' })))
  .expect(e => [e.result.toBe(3)])
  .expectCalls(call => [call(userRepository, 'save').notCalled()]))
ready.it('例外も同じexpect', t => t.args(1, 2).expect(e => [e.error.toThrow('bad')]))
run(plan)

// A different object is an independent observation, even with the same type.
const shadowRepository: typeof userRepository = { async save() { return { id: 'shadow' } } }
mocked.it('別参照を記録する', t => t.args(1, 2).expectCalls(call => [
  call(shadowRepository, 'save').notCalled(),
]))
const observed = ready.it('計画に記述子がある', t => t.args(1, 2)
  .expectCalls(call => [call(mailService, 'send').notCalled()])).plan()
for (const c of observed.cases) {
  if (c.mode === 'todo') continue
  for (const a of c.calls) {
    const subject: 'call' = a.subject
    const target: object = a.object
    const key: string = a.key
    void [subject, target, key]
  }
  // @ts-expect-error call descriptors are readonly.
  c.calls.push({})
}
