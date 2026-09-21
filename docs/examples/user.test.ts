import { Test } from 'hanamaru'
import { createUser, userRepository, mailService } from './user.ts'

export const users = new Test()
  .target(createUser)
  // 以降のケースで使う共通設定。対象と振る舞いを一緒に決める。
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .mock(mailService, 'send', m => m.resolves(undefined))
  .it('保存して通知する', t => t
    .args({ name: 'Alice' })
    .expect(e => [
      e.result.toEqual({ id: 'u1' }),
      e.mock(mailService, 'send').calledOnceWith({ id: 'u1' }),
    ])
  )
  .it('保存に失敗したら通知しない', t => t
    // このケースだけ、共通設定を上書きする。
    .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
    .args({ name: 'Alice' })
    .expect(e => [
      e.error.toBeInstanceOf(Error),
      e.mock(mailService, 'send').notCalled(),
    ])
  )
