import { Test } from 'hanamaru'
import { createUser, userRepository, mailService } from './user.ts'

const creation = new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'mock-user' }))
  .it('保存して通知する', t => t
    .args({ name: 'Alice' })
    .expect(e => [e.result.toEqual({ id: 'mock-user' })])
    .expectCalls(call => [
      call(mailService, 'send').calledOnceWith({ id: 'mock-user' }),
    ]))
  .it('保存に失敗したら通知しない', t => t
    .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
    .args({ name: 'Alice' })
    .expect(e => [e.error.toThrow('save failed')])
    .expectCalls(call => [call(mailService, 'send').notCalled()]))

const saving = new Test()
  .target(userRepository, 'save')
  .it('ユーザーを保存する', t => t
    .args({ name: 'Alice' })
    .expect(e => [e.result.toEqual({ id: 'u1' })]))

export const registrations = new Test()
  .mock(mailService, 'send', m => m.resolves(undefined))
  .group('作成', [creation])
  .group([saving])
