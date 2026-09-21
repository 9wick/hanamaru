import { Test } from 'hanamaru'
import { createUser, userRepository, mailService } from './user.ts'

export interface UserContext {
  input: { name: string }
  expectedId: string
}

export const userCases = new Test<UserContext>()
  .target(createUser)
  .setup(ctx => ({ expected: { id: ctx.expectedId } }))
  .it('保存して通知する', t => t
    .argsFrom(ctx => [ctx.input])
    .expect(e => [e.result.toEqual(e.ctx.expected)])
    .expectCalls(call => [call(mailService, 'send').calledTimes(1)]))
  .it('保存に失敗したら通知しない', t => t
    .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
    .argsFrom(ctx => [ctx.input])
    .expect(e => [e.error.toThrow('save failed')])
    .expectCalls(call => [call(mailService, 'send').notCalled()]))
