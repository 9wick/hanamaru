import { Test, middleware } from 'hanamaru'

// #region supply
const child = new Test<{ seed: number }>()
  .target((value: number) => value)
  .it('渡された値を使う', t => t.argsFrom(ctx => [ctx.seed])
    .expect(e => [e.result.toBe(e.ctx.seed)]))

const provideSeed = middleware(async (_, next) => next({ seed: 2 }))
export const suppliedPerAttempt = new Test().use(provideSeed).group([child])
export const suppliedPerGroup = new Test().group(provideSeed, [child])
// #endregion supply

// #region group-phase
const expectedChild = new Test<{ expected: number }>()
  .target((value: number) => value)
  .it('groupが渡す期待値', t => t.argsFrom(ctx => [ctx.expected])
    .expect(e => [e.result.toBe(e.ctx.expected)]))

const seededGroup = new Test<{ seed: number }>()
  .group(middleware(async (ctx, next) =>
    next({ expected: ctx.seed + 1 })), [expectedChild])

export const seededTests = new Test().group(provideSeed, [seededGroup])
// #endregion group-phase
