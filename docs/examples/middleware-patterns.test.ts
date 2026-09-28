import { AsyncLocalStorage } from 'node:async_hooks'
import { Test, registerTest, middleware } from 'hanamaru'
import { createDatabase, countUsers } from './database.ts'

const storage = new AsyncLocalStorage<{ requestId: string }>()

// 引数ではなく非同期コンテキストから値を読む対象。囲めていなければ'なし'になる。
function currentRequestId(): string {
  return storage.getStore()?.requestId ?? 'なし'
}

const requestScope = new Test()
  // #region wrap
  .use(middleware(async (_, next) => {
    return await storage.run({ requestId: 'test' }, async () => {
      return await next()
    })
  }))
  // #endregion wrap
  .target(currentRequestId)
  .it('nextを囲むと対象まで非同期コンテキストが伝わる', t => t
    .args()
    .expect(e => [e.result.toBe('test')]))

const databaseScope = new Test()
  // #region timeout
  .use(middleware(async (_, next) => {
    const db = await createDatabase()
    try {
      return await next({ db })
    } finally {
      await db.close()
    }
  }, { timeout: 30_000 }))
  // #endregion timeout
  .target(countUsers)
  .it('前処理と後処理に期限を設ける', t => t
    .argsFrom(ctx => [ctx.db])
    .expect(e => [e.result.toBe(3)]))

export const middlewarePatterns = new Test().group([requestScope, databaseScope])

registerTest(middlewarePatterns)
