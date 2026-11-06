import type { Action, State } from '../definition/observation.js'
import { checkedAction, ObservationOwner } from '../definition/observation.js'
import type { Ctx } from '../definition/types.js'
import type { AnyFn } from '../definition/target-types.js'
import type { Value } from '../definition/javascript.js'
import { valueOf } from '../definition/javascript.js'
import { Condition } from './compiled-checks.js'
import { Subject, ErrorSubject, type Requirement } from './subjects.js'
import { actionReference, checkedReference, indexedReference, reference, stateReference } from './references.js'
import type { Ref, RefArguments, ReferenceSource, ReferenceOrigin, referenceType } from './references.js'

type ArgumentOrigin<V> = V extends { readonly [referenceType]: { readonly origin: infer O extends ReferenceOrigin } }
  ? O
  : never
export type StateOrigin<A extends readonly unknown[]> = 'state' | ArgumentOrigin<A[number]>

export interface StatePart<T, O extends ReferenceOrigin = 'state'> {
  toEqual: Subject<T, O>['toEqual']
  part<K extends keyof NonNullable<T>>(key: K): StatePart<NonNullable<T>[K], O>
}
export type BeforeAvailable<O extends ReferenceOrigin, T> =
  Extract<O, 'result' | 'step' | 'record' | 'final-record'> extends never ? T : {}
export type StateCheckpoint<T, O extends ReferenceOrigin = 'state'> = StatePart<T, O> &
  BeforeAvailable<O, Pick<StateSubject<T, O>, 'unchanged'>>
type StateChecks<T, O extends ReferenceOrigin = 'state'> = StateCheckpoint<T, O> &
  Pick<StateSubject<T, O>, 'eventually'> & { after(step: Ref<unknown, 'step'>): StateCheckpoint<T, O> }
export class StateSubject<T, O extends ReferenceOrigin = 'state'> extends Subject<T, O> {
  before(): Ref<T, O> {
    if (this.source.kind !== 'state' || this.source.timing.kind !== 'after-plan' || this.source.timing.wait)
      throw new TypeError('before requires a state observation without waiting')
    return reference(this.owner, { ...this.source, timing: { kind: 'before' } })
  }
  after(step: Ref<unknown, 'step'>): StateSubject<T, O> {
    if (this.source.kind !== 'state' || this.source.timing.kind !== 'after-plan' || this.source.timing.wait)
      throw new TypeError('after requires an untimed state observation')
    return new StateSubject<T, O>(this.owner, {
      ...this.source,
      timing: { kind: 'after-step', step: checkedReference(step, this.owner) },
    })
  }
  unchanged(): Condition<Requirement<O>> {
    if (
      this.source.kind !== 'state' ||
      this.source.timing.kind === 'before' ||
      (this.source.timing.kind === 'after-plan' && this.source.timing.wait)
    )
      throw new TypeError('unchanged requires a state observation without waiting')
    const before = reference<T, O>(this.owner, { ...this.source, timing: { kind: 'before' } })
    return new Condition(this.owner, {
      kind: 'unchanged',
      before: checkedReference(before, this.owner),
      after: this,
    })
  }
  eventually(wait: { readonly withinMs: number; readonly intervalMs: number }): StatePart<T, O> {
    if (
      !Number.isFinite(wait.withinMs) ||
      !Number.isFinite(wait.intervalMs) ||
      wait.intervalMs <= 0 ||
      wait.withinMs < wait.intervalMs
    )
      throw new TypeError('eventually requires finite positive intervals within the deadline')
    if (this.source.kind !== 'state' || this.source.timing.kind !== 'after-plan' || this.source.timing.wait)
      throw new TypeError('eventually requires an untimed after-plan observation')
    return new Subject<T, O>(this.owner, {
      ...this.source,
      timing: { kind: 'after-plan', wait: Object.freeze({ ...wait }) },
    })
  }
}
export class ActionSubject<E> extends Subject<readonly E[], 'action'> {
  count(expected: number): Condition<'neutral'> {
    if (!Number.isSafeInteger(expected) || expected < 0)
      throw new TypeError('action count must be a nonnegative safe integer')
    return new Condition(this.owner, { kind: 'count', ref: this, expected })
  }
  none(): Condition<'neutral'> {
    return this.count(0)
  }
}
export interface ActionSelection<E> {
  untilTargetSettles(): Pick<ActionSubject<E>, 'toEqual' | 'count' | 'none'>
  forAfterTarget(milliseconds: number): Pick<ActionSubject<E>, 'toEqual' | 'count' | 'none'>
}
export interface ExampleExpect<F extends AnyFn, C> {
  readonly result: Subject<Awaited<ReturnType<F>>, 'result'>
  readonly error: ErrorSubject
  readonly ctx: Ctx<C>
  input<K extends keyof Parameters<F> & number>(index: K): Ref<Parameters<F>[K], 'input'>
  value<T>(value: T): Ref<T, 'value'>
}
export interface EffectExpect<F extends AnyFn, C> extends ExampleExpect<F, C> {
  state<S extends AnyFn, const A extends RefArguments<Parameters<S>>>(
    token: State<S>,
    ...args: A
  ): StateChecks<Awaited<ReturnType<S>>, StateOrigin<A>>
  action<E>(token: Action<E>): ActionSelection<E>
}

export function expectation<F extends AnyFn, C>(
  owner: ObservationOwner,
  ctx: Ctx<C>,
  mode: 'pure',
  resultSource?: ReferenceSource,
): ExampleExpect<F, C>
export function expectation<F extends AnyFn, C>(
  owner: ObservationOwner,
  ctx: Ctx<C>,
  mode: 'effectful',
  resultSource?: ReferenceSource,
): EffectExpect<F, C>
export function expectation(
  owner: ObservationOwner,
  ctx: object,
  mode: 'pure' | 'effectful',
  resultSource: ReferenceSource = { kind: 'result' },
): object {
  const result = new Subject<Value, 'result'>(owner, resultSource)
  const error = new ErrorSubject(owner, { kind: 'error' })
  const base = {
    result,
    error,
    ctx,
    input: (index: number) => indexedReference(owner, 'input', index),
    value: <T>(value: T) => reference<T, 'value'>(owner, { kind: 'value', value: valueOf(value) }),
  }
  if (mode === 'pure') return Object.freeze(base)
  return Object.freeze({
    ...base,
    state<S extends AnyFn>(token: State<S>, ...args: RefArguments<Parameters<S>>) {
      return new StateSubject<Awaited<ReturnType<S>>>(
        owner,
        checkedReference(stateReference(owner, token, args), owner).source,
      )
    },
    action<E>(token: Action<E>): ActionSelection<E> {
      checkedAction(token, owner)
      return Object.freeze({
        untilTargetSettles: () =>
          new ActionSubject<E>(
            owner,
            checkedReference(actionReference(owner, token, { kind: 'settled' }), owner).source,
          ),
        forAfterTarget: (milliseconds: number) =>
          new ActionSubject<E>(
            owner,
            checkedReference(actionReference(owner, token, { kind: 'after', milliseconds }), owner).source,
          ),
      })
    },
  })
}
