import { Config } from '@zeltjs/core'
import type { Value } from '../../foundation/value.js'

/** 値の一致の見方。比較ライブラリの選択はinfrastructureが決める。 */
@Config({ abstract: true })
export abstract class Comparison {
  abstract equal(first: Value, second: Value): boolean
  abstract matchObject(actual: Value, expected: Value): boolean
}
