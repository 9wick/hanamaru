import { Test, registerTest, middleware } from 'hanamaru'
import { add } from './math.ts'

const child = new Test<{ a: number }>()
  .target(add)
  .it('親の値を使う', t => t.argsFrom(ctx => [ctx.a, 2])
    .expect(e => [e.result.toBe(3)]))

export const parentContext = new Test()
  .use(middleware(async (_, next) => next({ a: 1, extra: true })))
  .group([child])

registerTest(parentContext)
