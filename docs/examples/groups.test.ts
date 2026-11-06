import { Test, registerTest, middleware } from 'hanamaru'
import { userCases } from './user-cases.ts'
import { add } from './math.ts'
const addition = new Test().target(add).it('加算', t => t.args(1, 2).expect(e => [e.result.toEqual(3)]))
const userGroup = new Test().group('ユーザー', middleware(async (_, next) => next({ input: { name: 'Alice' }, expectedId: 'u1' })), [userCases])
export const registrations = new Test().group('作成', [userGroup]).group('計算', [addition])
registerTest(registrations)
