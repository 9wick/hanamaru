import { Test, registerTest } from 'hanamaru'
import { UserService } from './user.ts'
import { userEnvironment } from './user-environment.ts'
registerTest(new Test().target(UserService, 'create').effectful().use(userEnvironment()).from(ctx => ctx.users)
  .it('結果のIDで保存状態を読む', t => t.args({ name: 'Alice' })
    .expect(e => [e.state(e.ctx.saved, e.result.field('id')).toEqual({ name: 'Alice' })])))
