import { Test, middleware } from 'hanamaru'
import { request, startServer, type Server } from './server.ts'

const listUsers = new Test<{ server: Server }>()
  .target(request)
  .it('一覧は200を返す', t => t
    .argsFrom(ctx => [ctx.server, '/users'])
    .expect(e => [e.result.toBe(200)]))

const missingPage = new Test<{ server: Server }>()
  .target(request)
  .it('未知のパスは404を返す', t => t
    .argsFrom(ctx => [ctx.server, '/missing'])
    .expect(e => [e.result.toBe(404)]))

// #region group-middleware
export const serverTests = new Test()
  .group(middleware(async (_, next) => {
    const server = await startServer()
    try {
      return await next({ server })
    } finally {
      await server.stop()
    }
  }), [listUsers, missingPage])
// #endregion group-middleware
