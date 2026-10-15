import type {} from 'hanamaru'
import * as data from './data.ts'

const multiplier = 2
function privateCalc() { return data.getData() * multiplier }

if (import.meta.hanamaru) {
  const { Test, registerTest } = import.meta.hanamaru
  registerTest(new Test().mock(data, 'getData', m => m.returns(10)).target(privateCalc)
    .it('非公開の実装と依存を検証する', t => t.args().expect(e => [e.result.toBe(20)])))
}
