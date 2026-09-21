import { Test } from 'hanamaru'
import { add } from './math.ts'

export const addition = new Test()
  .target(add, { source: { file: 'src/math.ts', exportName: 'add' } })
  .it('2つの数を足す', t => t.args(1, 2).expect(e => [
    e.result.toBe(3),
  ]), { id: 'adds-two-numbers' })
