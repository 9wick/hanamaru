import { Test } from 'hanamaru'
import { add } from './math.ts'

export const namedRows = new Test().target(add).each(
  row => `${row.a} + ${row.b}`,
  [{ a: 1, b: 2, expected: 3 }],
  (t, row) => t.args(row.a, row.b).expect(e => [e.result.toBe(row.expected)]),
)
