import type { Value } from '../../foundation/value.js'
import { assertionTag } from '../definition/tags.js'

export type CallExpectations = readonly [CallAssertion, ...CallAssertion[]]

export type ValueCheck<V> =
  | { readonly matcher: 'toBe' | 'toEqual'; readonly expected: V }
  | { readonly matcher: 'toMatchObject'; readonly expected: V extends object ? Partial<V> : never }
  | { readonly matcher: 'toSatisfy'; readonly predicate: (value: V) => boolean }

/** 検証前の条件を表す記述子。判定後の結果ではない。 */
export type ResultAssertion<V = Value> = {
  readonly [assertionTag]: true
  readonly subject: 'result'
  readonly check: ValueCheck<V>
}

/** 異なる戻り値の型を持つ記述子をまとめる際の形。関数の呼び出しは境界で検証する。 */
export type ErasedResultAssertion = {
  readonly [assertionTag]: true
  readonly subject: 'result'
  readonly check:
    | { readonly matcher: 'toBe' | 'toEqual' | 'toMatchObject'; readonly expected: Value | void }
    | { readonly matcher: 'toSatisfy'; readonly predicate: object }
}

/** 例外について照合する条件の記述子。判定後の結果ではない。 */
export type ErrorAssertion = {
  readonly [assertionTag]: true
  readonly subject: 'error'
  readonly check:
    | { readonly matcher: 'toBeInstanceOf'; readonly ctor: new (...args: never[]) => object }
    | { readonly matcher: 'toThrow'; readonly message: string | RegExp }
    | { readonly matcher: 'toMatchObject'; readonly expected: Record<string, Value> }
    | { readonly matcher: 'toSatisfy'; readonly predicate: (error: Value) => boolean }
}

/** 呼び出し記録について照合する条件の記述子。判定後の結果ではない。 */
export type CallAssertion = {
  readonly [assertionTag]: true
  readonly subject: 'call'
  readonly key: string
  readonly check:
    | { readonly matcher: 'calledTimes'; readonly count: number }
    | { readonly matcher: 'notCalled' }
    | { readonly matcher: 'calledWith' | 'calledOnceWith'; readonly args: readonly Value[] }
    | { readonly matcher: 'calledNthWith'; readonly n: number; readonly args: readonly Value[] }
    | { readonly matcher: 'calledWith' | 'calledOnceWith'; readonly argsFrom: object }
    | { readonly matcher: 'calledNthWith'; readonly n: number; readonly argsFrom: object }
} & (
  | { readonly object: object; readonly objectFrom?: never }
  | { readonly objectFrom: object; readonly object?: never }
)

/** 結果または例外について照合する条件の記述子。 */
export type Assertion = ErasedResultAssertion | ErrorAssertion

export type Assertions =
  | readonly [ErasedResultAssertion, ...ErasedResultAssertion[]]
  | readonly [ErrorAssertion, ...ErrorAssertion[]]
