import { Test, registerTest, middleware } from 'hanamaru'
import { add } from './math.ts'
import { createUser, userRepository } from './user.ts'

// #region targets
const byFunction = new Test().target(createUser)
const byMethod = new Test().target(userRepository, 'save')
const namedFunction = new Test().target('ユーザー作成', createUser)
const namedMethod = new Test().target('保存', userRepository, 'save')
// #endregion targets

const creating = byFunction
  .it('関数を対象にする', t => t.args({ name: 'Alice' }).expect(e => [e.result.toEqual({ id: 'u1' })]))
const saving = byMethod
  .it('メソッドを対象にする', t => t.args({ name: 'Alice' }).expect(e => [e.result.toEqual({ id: 'u1' })]))
const namedCreating = namedFunction
  .it('名前を付けた関数を対象にする', t => t.args({ name: 'Bob' }).expect(e => [e.result.toEqual({ id: 'u1' })]))
const namedSaving = namedMethod
  .it('名前を付けたメソッドを対象にする', t => t.args({ name: 'Bob' }).expect(e => [e.result.toEqual({ id: 'u1' })]))

// #region stacked
const stacked = new Test()
  .use(middleware(async (_, next) => next({ a: 1 })))
  .use(middleware(async (ctx, next) => next({ expected: ctx.a + 2 })))
  .target(add)
  .it('middlewareを積み重ねる', t => t
    .argsFrom(ctx => [ctx.a, 2])
    .expect(e => [e.result.toBe(e.ctx.expected)]))
// #endregion stacked

export const testBuilder = new Test().group([creating, saving, namedCreating, namedSaving, stacked])

registerTest(testBuilder)
