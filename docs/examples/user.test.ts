import { Test, registerTest } from 'hanamaru'
import { UserService } from './user.ts'
import { userEnvironment } from './user-environment.ts'

const successful = new Test().target(UserService, 'create').effectful()
  .use(userEnvironment()).from(ctx => ctx.users)
  .it('保存して通知する', t => t.args({ name: 'Alice' }).expect(e => [
    e.result.toEqual({ id: 'u1' }),
    e.state(e.ctx.saved, e.result.field('id')).toEqual({ name: 'Alice' }),
    e.state(e.ctx.delivered).toEqual([{ recipient: 'u1' }]),
  ]))
const failing = new Test().target(UserService, 'create').effectful()
  .use(userEnvironment({ saveFails: true })).from(ctx => ctx.users)
  .it('保存失敗を返し、通知しない', t => t.args({ name: 'Alice' }).expect(e => [
    e.error.message.toEqual('save failed'),
    e.state(e.ctx.delivered).toEqual([]),
  ]))
export const users = new Test().group('ユーザー登録', [successful, failing])
registerTest(users)
