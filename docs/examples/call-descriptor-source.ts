import { Test } from 'hanamaru'
import { createUser, mailService } from './user.ts'

export const notification = new Test()
  .target(createUser)
  .it('登録を通知する', t => t
    .args({ name: 'Alice' })
    // #region expect-calls
    .expectCalls(call => [
      call(mailService, 'send').calledOnceWith({ id: 'u1' }),
    ])
    // #endregion expect-calls
  )
