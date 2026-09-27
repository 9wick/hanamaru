import { Test } from 'hanamaru'
import { createUser, userRepository, mailService } from './user.ts'

interface Account { id: string }

const api = {
  async fetch(id: string): Promise<Account> {
    return { id }
  },
}

// 一時的な失敗を1回だけ再試行する対象。onceを並べた振る舞いの検証に使う。
async function fetchAccount(id: string): Promise<Account> {
  try {
    return await api.fetch(id)
  } catch {
    return await api.fetch(id)
  }
}

const resolved = new Test()
  .target(createUser)
  // #region mock
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  // #endregion mock
  .it('保存して通知する', t => t
    .args({ name: 'Alice' })
    // #region verify
    .expect(e => [
      e.result.toEqual({ id: 'u1' }),
    ])
    .expectCalls(call => [
      call(userRepository, 'save').calledOnceWith({ name: 'Alice' }),
      call(mailService, 'send').calledOnceWith({ id: 'u1' }),
    ])
    // #endregion verify
  )

const faked = new Test()
  .target(createUser)
  // #region calls-fake
  .mock(userRepository, 'save', m => m.callsFake(async input => ({ id: input.name })))
  // #endregion calls-fake
  .it('fakeが受け取った引数から結果を作る', t => t
    .args({ name: 'Alice' })
    .expect(e => [e.result.toEqual({ id: 'Alice' })]))

const retried = new Test()
  .target(fetchAccount)
  .it('1回目の失敗を再試行する', t => t
    // #region sequence
    .mock(api, 'fetch', m => m
      .rejectsOnce(new Error('temporary failure'))
      .resolves({ id: 'u1' }))
    // #endregion sequence
    .args('u1')
    .expect(e => [e.result.toEqual({ id: 'u1' })])
    .expectCalls(call => [call(api, 'fetch').calledTimes(2)]))

export const mockBehaviors = new Test().group([resolved, faked, retried])
