import { Test, registerTest, type CallAssertion } from 'hanamaru'
import { mailService } from './user.ts'
import { notification } from './call-descriptor-source.ts'

// todoケースは実行本体を持たないため、記述子を取り出せるのは他のケースだけ。
function firstCallAssertion(): CallAssertion | undefined {
  const first = notification.blueprint().cases[0]
  if (first.mode === 'todo') return undefined
  return first.calls[0]
}

export const callDescriptor = new Test()
  .target(firstCallAssertion)
  .it('定義時に組み立てた呼び出し条件を保持する', t => t
    .args()
    // #region descriptor
    .expect(e => [e.result.toMatchObject({
      subject: 'call',
      object: mailService,
      key: 'send',
      check: { matcher: 'calledOnceWith', args: [{ id: 'u1' }] },
    })])
    // #endregion descriptor
  )

registerTest(callDescriptor)
