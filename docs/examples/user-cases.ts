import { Test } from 'hanamaru'
import { UserService } from './user.ts'
import { userEnvironment } from './user-environment.ts'

export interface UserContext { input: { name: string }; expectedId: string }
export const userCases = new Test<UserContext>().target(UserService, 'create').effectful()
  .use(userEnvironment()).from(ctx => ctx.users)
  .it('保存して通知する', t => t.argsFrom(ctx => [ctx.input]).expect(e => [
    e.result.toEqual({ id: e.ctx.expectedId }),
    e.state(e.ctx.saved, e.result.field('id')).toEqual(e.ctx.input),
    e.state(e.ctx.delivered).toEqual([{ recipient: e.ctx.expectedId }]),
  ]))
