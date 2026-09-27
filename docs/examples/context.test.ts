import { Test, middleware } from 'hanamaru'
import { add } from './math.ts'

export const contextAddition = new Test()
  .target(add)
  .use(middleware(async (_, next) => next({ a: 1, b: 2, expected: 3 })))
  .it('渡された値を使う', t => t
    .argsFrom(ctx => [ctx.a, ctx.b])
    .expect(e => [e.result.toBe(e.ctx.expected)]))
