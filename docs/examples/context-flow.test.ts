import { Test, registerTest, middleware } from 'hanamaru'
import { add } from './math.ts'

export const contextFlow = new Test()
  .target(add)
  // #region values
  .use(middleware(async (_, next) => next({ a: 1, expected: 3 })))
  // #endregion values
  .it('渡された値を使う', t => t
    .argsFrom(ctx => [ctx.a, 2])
    .expect(e => [e.result.toBe(e.ctx.expected)]))

registerTest(contextFlow)
