import { Test, registerTest } from 'hanamaru'
import { UserService } from './user.ts'
import { userEnvironment } from './user-environment.ts'

const successful = new Test().target(UserService, 'create').effectful()
  .use(userEnvironment({ id: 'custom-id' })).from(ctx => ctx.users)
  .it('代替環境の保存と配送を検証する', t => t.args({ name: 'Alice' }).expect(e => [
    e.result.toEqual({ id: 'custom-id' }),
    e.state(e.ctx.saved, e.result.field('id')).toEqual({ name: 'Alice' }),
    e.state(e.ctx.delivered).toEqual([{ recipient: 'custom-id' }]),
  ]))
registerTest(successful)
