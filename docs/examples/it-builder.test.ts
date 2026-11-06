import { Test, registerTest, middleware } from 'hanamaru'
import { add } from './math.ts'
import { UserService } from './user.ts'
import { userEnvironment } from './user-environment.ts'
const creation = new Test().target(UserService, 'create').effectful().use(userEnvironment()).from(ctx => ctx.users)
  .it('保存して通知する', t => t.args({ name: 'Alice' }).expect(e => [
    e.result.toEqual({ id: 'u1' }), e.state(e.ctx.delivered).toEqual([{ recipient: 'u1' }]),
  ]))
const failing = new Test().target(UserService, 'create').effectful().use(userEnvironment({ saveFails: true })).from(ctx => ctx.users)
  .it('保存失敗時は配送しない', t => t.args({ name: 'Alice' }).expect(e => [
    e.error.message.toEqual('save failed'), e.state(e.ctx.delivered).toEqual([]),
  ]))
const addition = new Test().use(middleware(async (_, next) => next({ a: 1, b: 2 }))).target(add)
  .it('具体的な引数', t => t.args(1, 2).expect(e => [e.result.toEqual(3)]))
  .it('コンテキストから引数を作る', t => t.argsFrom(ctx => [ctx.a, ctx.b]).expect(e => [e.result.toEqual(3)]))
registerTest(new Test().group([creation, failing, addition]))
