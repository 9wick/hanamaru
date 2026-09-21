import { Test } from 'hanamaru'
import { createUser, userRepository, mailService } from './user.ts'

export const users = new Test()
  .target(createUser, { source: { file: 'src/user.ts', exportName: 'createUser' } })
  .mock('save', userRepository, 'save', m => m.resolves({ id: 'u1', name: 'Alice' }))
  .mock('send', mailService, 'send', m => m.resolves(undefined))
  .it('保存して通知する', t => t
    .args({ name: 'Alice' })
    .expect(e => [
      e.result.toEqual({ id: 'u1', name: 'Alice' }),
      e.mock('save').calledOnceWith({ name: 'Alice' }),
      e.mock('send').calledOnceWith({ id: 'u1', name: 'Alice' }),
    ]), { id: 'save-and-notify' })
  .it('保存に失敗したら通知しない', t => t
    .override('save', m => m.rejects(new Error('save failed')))
    .args({ name: 'Alice' })
    .expectError(e => [
      e.error.toThrow('save failed'),
      e.mock('send').notCalled(),
    ]), { id: 'save-failure' })
