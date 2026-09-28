import { Test, registerTest } from 'hanamaru'
import * as data from './data.ts'
import { calc } from './calc.ts'

export const namespaceMock = new Test().target(calc)
  .it('依存を差し替える', t => t
    .mock(data, 'getData', m => m.returns(10))
    .args()
    .expect(e => [e.result.toBe(20)])
    .expectCalls(call => [call(data, 'getData').calledTimes(1)]))

registerTest(namespaceMock)
