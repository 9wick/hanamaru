import { Test, registerTest, middleware } from 'hanamaru'
import { add } from './math.ts'
import { userCases } from './user-cases.ts'
const addition = new Test().target(add).it('加算', t => t.args(1, 2).expect(e => [e.result.toEqual(3)]))
const subtraction = new Test().target((a: number, b: number) => a - b).it('減算', t => t.args(3, 1).expect(e => [e.result.toEqual(2)]))
const grouped = new Test().group('基本', [addition, subtraction]).group('再確認', [addition])
const inner = new Test().group('内側', [addition])
const outer = new Test().group('外側', [inner])
const userGroup = new Test().group('ユーザー', middleware(async (_, next) => next({ input: { name: 'Alice' }, expectedId: 'u1' })), [userCases])
registerTest(new Test().group([grouped, outer, userGroup]))
