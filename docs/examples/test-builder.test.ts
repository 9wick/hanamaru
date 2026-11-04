import { Test, registerTest, middleware } from 'hanamaru'
import { add } from './math.ts'
const calculator = { sum: add }
const byFunction = new Test().target(add)
const byMethod = new Test().target(calculator, 'sum')
const namedFunction = new Test().target('加算', add)
const namedMethod = new Test().target('合計', calculator, 'sum')
const creating = byFunction.it('関数', t => t.args(1, 2).expect(e => [e.result.toEqual(3)]))
const saving = byMethod.it('メソッド', t => t.args(1, 2).expect(e => [e.result.toEqual(3)]))
const namedCreating = namedFunction.it('名前付き関数', t => t.args(2, 3).expect(e => [e.result.toEqual(5)]))
const namedSaving = namedMethod.it('名前付きメソッド', t => t.args(2, 3).expect(e => [e.result.toEqual(5)]))
const stacked = new Test()
  .use(middleware(async (_, next) => next({ a: 1 })))
  .use(middleware(async (ctx, next) => next({ expected: ctx.a + 2 })))
  .target(add).it('コンテキストを合成する', t => t.argsFrom(ctx => [ctx.a, 2]).expect(e => [e.result.toEqual(e.ctx.expected)]))
registerTest(new Test().group([creating, saving, namedCreating, namedSaving, stacked]))
