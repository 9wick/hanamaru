import { Test, middleware, type Ctx } from 'hanamaru'
import { add } from './math.ts'

// 変数へ入れて使い回すmiddlewareには文脈がないので、読む値をCtx<…>で要求する。
const withExpected = middleware(async (ctx: Ctx<{ seed: number }>, next) =>
  next({ expected: ctx.seed + 1 }))

export const reusedMiddleware = new Test()
  .use(middleware(async (_, next) => next({ seed: 2 })))
  .use(withExpected)
  .target(add)
  .it('要求したseedから期待値を作る', t => t
    .argsFrom(ctx => [ctx.seed, 1])
    .expect(e => [e.result.toBe(e.ctx.expected)]))
