import { Test } from 'hanamaru'
import { add } from './math.ts'
// onlyを含むため、CLIの探索対象になる *.test.ts には置かない。
export const caseModes = new Test().target(add)
  .it('加算する', t => t.args(1, 2).expect(e => [e.result.toEqual(3)]))
  .only('集中して確認する', t => t.args(2, 3).expect(e => [e.result.toEqual(5)]))
  .skip('修正待ち', t => t.args(3, 4).expect(e => [e.result.toEqual(7)]))
  .todo('境界値を追加する')
