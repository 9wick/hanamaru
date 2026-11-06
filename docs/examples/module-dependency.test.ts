import { Test, registerTest } from 'hanamaru'
import { calc } from './calc.ts'
// importされた依存も含めて対象の契約を実行する。
registerTest(new Test().target(calc).it('取得値を2倍する', t => t.args().expect(e => [e.result.toEqual(10)])))
