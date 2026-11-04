import type {} from 'hanamaru'
import { getData } from './data.ts'
const multiplier = 2
function privateCalc() { return getData() * multiplier }
if (import.meta.hanamaru) {
  const { Test, registerTest } = import.meta.hanamaru
  registerTest(new Test().target(privateCalc)
    .it('取得値を2倍する', t => t.args().expect(e => [e.result.toEqual(10)])))
}
