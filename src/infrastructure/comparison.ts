import { equals, iterableEquality, subsetEquality } from '@vitest/expect'
import { Config } from '@zeltjs/core'
import { Comparison } from '../application/ports/comparison.js'
import type { Value } from '../foundation/value.js'

/** 値の一致をvitestのexpectと同じ規則で見る。 */
@Config()
export class ValueComparison extends Comparison {
  equal(first: Value, second: Value): boolean {
    return equals(first, second, [iterableEquality])
  }

  matchObject(actual: Value, expected: Value): boolean {
    return equals(actual, expected, [iterableEquality, subsetEquality])
  }
}
