import { Test, registerTest, middleware } from 'hanamaru'
import { add } from './math.ts'
import { createUser, userRepository, mailService } from './user.ts'

const created = new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .it('結果に複数の条件を並べる', t => t
    .args({ name: 'Alice' })
    // #region result
    .expect(e => [
      e.result.toEqual({ id: 'u1' }),
      e.result.toSatisfy(user => user.id.startsWith('u')),
    ])
    // #endregion result
  )
  .it('指定した値と深く一致しない', t => t
    .args({ name: 'Alice' })
    // #region not-result
    .expect(e => [e.result.not.toEqual({ id: 'missing' })])
    // #endregion not-result
  )
  .it('保存に失敗したら通知しない', t => t
    .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
    .args({ name: 'Alice' })
    // #region error
    .expect(e => [
      e.error.toBeInstanceOf(Error),
      e.error.toThrow('save failed'),
      e.error.not.toThrow('network failed'),
    ])
    .expectCalls(call => [
      call(mailService, 'send').notCalled(),
    ])
    // #endregion error
  )
  .it('渡した引数で1回だけ保存する', t => t
    .args({ name: 'Alice' })
    // #region calls
    .expectCalls(call => [
      call(userRepository, 'save').calledOnceWith({ name: 'Alice' }),
    ])
    // #endregion calls
  )

// #region context
const withContext = new Test()
  .target(add)
  .use(middleware(async (_, next) => next({ input: [1, 2] as const, expected: 3 })))
  .it('ctxを使う', t => t
    .argsFrom(ctx => [...ctx.input])
    .expect(e => [e.result.toBe(e.ctx.expected)]))
// #endregion context

const withNegation = new Test()
  .target(add)
  .it('合計が0ではない', t => t
    .args(1, 2)
    // #region not
    .expect(e => [e.result.not.toBe(0)])
    // #endregion not
  )

export const matchers = new Test().group([created, withContext, withNegation])

registerTest(matchers)
