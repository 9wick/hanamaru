import type { ValueAdapter } from './value-adapter.js'
import { Condition, closeCondition, equalCondition } from './compiled-checks.js'
import { RuntimeReference, reference, referenceType } from './references.js'
import type { Ref, ReferenceOrigin, ReferenceModeOf, ReferenceSource } from './references.js'
import { valueOf } from '../definition/javascript.js'

export type Requirement<O extends ReferenceOrigin> = O extends 'result' | 'final-record'
  ? 'return'
  : O extends 'error'
    ? 'throw'
    : O extends 'outcome'
      ? 'return-or-throw'
      : 'neutral'
type AdapterFor<T> = T extends object ? ValueAdapter<T> : never

function selectedSource(ref: RuntimeReference, key: PropertyKey): ReferenceSource {
  if (ref.source.kind !== 'record') return { kind: 'field', parent: ref, key }
  if (typeof key !== 'string' || !Object.hasOwn(ref.source.fields, key))
    throw new TypeError('result field is not declared in steps')
  return { kind: 'alias', parent: ref.source.fields[key], key }
}

/** itで使える具体値・部分・許容誤差の入口。否定や任意述語は持たない。 */
export class Subject<T, O extends ReferenceOrigin> extends RuntimeReference implements Ref<T, O> {
  declare readonly [referenceType]: {
    readonly value: T
    readonly origin: O
    readonly representation: ReferenceModeOf<O>
  }
  field<K extends keyof NonNullable<T>>(key: K): Ref<NonNullable<T>[K], O> {
    return reference(this.owner, selectedSource(this, key))
  }
  part<K extends keyof NonNullable<T>>(key: K): Subject<NonNullable<T>[K], O> {
    return new Subject(this.owner, selectedSource(this, key))
  }
  toEqual(expected: T, adapter?: AdapterFor<T>): Condition<Requirement<O>> {
    return equalCondition<Requirement<O>>(this.owner, this, valueOf(expected), adapter ?? null)
  }
  toBe(expected: T): Condition<Requirement<O>> {
    return new Condition(this.owner, { kind: 'identity', ref: this, expected: valueOf(expected) })
  }
  toBeCloseTo(
    expected: T extends number ? number : never,
    options: { readonly absoluteTolerance: number },
  ): Condition<Requirement<O>> {
    return closeCondition<Requirement<O>>(this.owner, this, expected, options.absoluteTolerance)
  }
}

export class ErrorSubject<T = unknown> extends Subject<T, 'error'> {
  ofType<I extends object>(ctor: abstract new (...args: never[]) => I): ErrorSubject<I> {
    if (typeof ctor !== 'function') throw new TypeError('ofType requires a constructor')
    return new ErrorSubject(this.owner, { kind: 'error-type', parent: this, ctor })
  }
  get message(): Subject<string, 'error'> {
    return new Subject(this.owner, { kind: 'field', parent: this.ofType(Error), key: 'message' })
  }
}
