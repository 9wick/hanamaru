import { Test, middleware } from 'hanamaru'
import { add } from './math.ts'
import { createUser, userRepository, mailService } from './user.ts'

const creation = new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .it('保存して通知する', t => t
    .args({ name: 'Alice' })
    // #region expectations
    .expect(e => [
      e.result.toEqual({ id: 'u1' }),
    ])
    .expectCalls(call => [
      call(mailService, 'send').calledOnceWith({ id: 'u1' }),
    ])
    // #endregion expectations
  )
  // #region failure-case
  .it('保存に失敗したら通知しない', t => t
    .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
    .args({ name: 'Alice' })
    .expect(e => [
      e.error.toBeInstanceOf(Error),
    ])
    .expectCalls(call => [
      call(mailService, 'send').notCalled(),
    ])
  )
  // #endregion failure-case

const addition = new Test()
  .use(middleware(async (_, next) => next({ a: 1, b: 2 })))
  .target(add)
  // #region args
  .it('引数をそのまま渡す', t => t
    .args(1, 2)
    .expect(e => [e.result.toBe(3)]))
  .it('コンテキストから引数を作る', t => t
    .argsFrom(ctx => [ctx.a, ctx.b])
    .expect(e => [e.result.toBe(3)]))
  // #endregion args

export const itBuilder = new Test().group([creation, addition])
