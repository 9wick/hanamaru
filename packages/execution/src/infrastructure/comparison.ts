import { equals, iterableEquality, subsetEquality } from '@vitest/expect'
import { Injectable } from '@zeltjs/core'
import type { Value } from '../domain/execution/javascript.js'

/** 値の一致をvitestのexpectと同じ規則で見る。 */
@Injectable()
export class ValueComparison {
  equal(first: Value, second: Value): boolean {
    return equals(first, second, [iterableEquality])
  }

  matchObject(actual: Value, expected: Value): boolean {
    return equals(actual, expected, [iterableEquality, subsetEquality])
  }
}
