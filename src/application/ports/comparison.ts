import type { Value } from '../../foundation/value.js'
export interface Comparison {
  equal(first: Value, second: Value): boolean
  matchObject(actual: Value, expected: Value): boolean
}
