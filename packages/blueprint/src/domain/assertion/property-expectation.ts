import type { AnyFn } from '../definition/target-types.js'
import type { Ctx } from '../definition/types.js'
import type { Action, State } from '../definition/observation.js'
import { ObservationOwner } from '../definition/observation.js'
import { valueOf } from '../definition/javascript.js'
import { Condition } from './compiled-checks.js'
import type { Requirement } from './subjects.js'
import { expectation, StateSubject, ActionSubject } from './expectation.js'
import type { ExampleExpect, StatePart, StateOrigin, BeforeAvailable, StateCheckpoint } from './expectation.js'
import {
  RuntimeReference,
  checkedReference,
  reference,
  referenceType,
  indexedReference,
  stateReference,
  actionReference,
} from './references.js'
import type { Ref, RefArguments, ReferenceOrigin, ReferenceSource } from './references.js'

type Outcome<R, E> = { readonly kind: 'return'; readonly value: R } | { readonly kind: 'throw'; readonly error: E }
declare const identityType: unique symbol
export interface Identity {
  readonly [identityType]: true
}
export interface Predicate<T, O extends ReferenceOrigin> {
  satisfies(name: string, predicate: (value: T) => boolean): Condition<Requirement<O>>
}
type RefValue<T, O extends ReferenceOrigin = ReferenceOrigin> = Pick<
  Ref<T, O, 'live' | 'snapshot'>,
  typeof referenceType
>
type TypedError<T, O extends ReferenceOrigin> = O extends 'error' ? (unknown extends T ? never : unknown) : unknown
type TypedErrors<R> = { [K in keyof R]: R[K] extends RefValue<infer T, infer O> ? TypedError<T, O> : never }
type Values<R> = { readonly [K in keyof R]: R[K] extends RefValue<infer T> ? T : never }
type Origins<R> = R[keyof R] extends RefValue<unknown, infer O> ? O : never

export class OutcomeReference<R> extends RuntimeReference implements Ref<Outcome<R, unknown>, 'outcome'> {
  declare readonly [referenceType]: {
    readonly value: Outcome<R, unknown>
    readonly origin: 'outcome'
    readonly representation: 'live'
  }
  field(key: 'kind'): Ref<'return' | 'throw', 'outcome'> {
    return reference(this.owner, { kind: 'field', parent: this, key })
  }
  withError<E extends object>(ctor: abstract new (...args: never[]) => E): Ref<Outcome<R, null>, 'outcome'>
  withError<E extends object, D>(
    ctor: abstract new (...args: never[]) => E,
    project: (error: E) => D,
  ): Ref<Outcome<R, D>, 'outcome'>
  withError(ctor: object, project?: object): Ref<Outcome<R, unknown>, 'outcome'> {
    if (typeof ctor !== 'function' || (project !== undefined && typeof project !== 'function'))
      throw new TypeError('withError requires a constructor and optional projection function')
    return reference(this.owner, { kind: 'outcome-error', parent: this, ctor, project: project ?? null })
  }
}

export interface PropertyExpect<F extends AnyFn, C, S extends readonly unknown[]> extends ExampleExpect<F, C> {
  readonly outcome: OutcomeReference<Awaited<ReturnType<F>>>
  sample<K extends keyof S & number>(index: K): Ref<S[K], 'sample'>
  on<T, O extends ReferenceOrigin>(
    ref: RefValue<T, O> & { readonly withError?: never } & TypedError<NoInfer<T>, NoInfer<O>>,
  ): Predicate<T, O>
  on<R extends Readonly<Record<string, RefValue<unknown> & { readonly withError?: never }>>>(
    refs: keyof R extends never ? never : R & TypedErrors<NoInfer<R>>,
  ): Predicate<Values<R>, Origins<R>>
  project<T, U, O extends ReferenceOrigin>(
    ref: RefValue<T, O> & TypedError<NoInfer<T>, NoInfer<O>>,
    project: (value: T) => U,
  ): Ref<U, O, 'snapshot'>
  identity<T, O extends 'input' | 'result' | 'value' | 'step'>(ref: Ref<T, O, 'live'>): Ref<Identity, O>
}
export type PropertyState<T, O extends ReferenceOrigin = 'state'> = Ref<T, O> &
  StateCheckpoint<T, O> &
  BeforeAvailable<O, { before(): Ref<T, O> }> & {
    after(step: Ref<unknown, 'step'>): Ref<T, O> & StateCheckpoint<T, O>
    eventually(wait: { readonly withinMs: number; readonly intervalMs: number }): StatePart<T, O>
  }
type PropertyAction<E> = Ref<readonly E[], 'action'> & Pick<ActionSubject<E>, 'toEqual' | 'count' | 'none'>
export interface EffectPropertyExpect<F extends AnyFn, C, S extends readonly unknown[]> extends PropertyExpect<
  F,
  C,
  S
> {
  state<Q extends AnyFn, const A extends RefArguments<Parameters<Q>>>(
    token: State<Q>,
    ...args: A
  ): PropertyState<Awaited<ReturnType<Q>>, StateOrigin<A>>
  action<E>(token: Action<E>): {
    untilTargetSettles(): PropertyAction<E>
    forAfterTarget(milliseconds: number): PropertyAction<E>
  }
}

export function propertyExpectation<F extends AnyFn, C, S extends readonly unknown[]>(
  owner: ObservationOwner,
  ctx: Ctx<C>,
  mode: 'pure',
  resultSource?: ReferenceSource,
): PropertyExpect<F, C, S>
export function propertyExpectation<F extends AnyFn, C, S extends readonly unknown[]>(
  owner: ObservationOwner,
  ctx: Ctx<C>,
  mode: 'effectful',
  resultSource?: ReferenceSource,
): EffectPropertyExpect<F, C, S>
export function propertyExpectation(
  owner: ObservationOwner,
  ctx: object,
  mode: 'pure' | 'effectful',
  resultSource?: ReferenceSource,
): object {
  const base =
    mode === 'pure' ? expectation(owner, ctx, 'pure', resultSource) : expectation(owner, ctx, 'effectful', resultSource)
  const api = {
    ...base,
    outcome: new OutcomeReference(owner, { kind: 'outcome' }),
    sample: (index: number) => indexedReference(owner, 'sample', index),
    on(input: object) {
      const refs =
        input instanceof RuntimeReference
          ? checkedReference(input, owner)
          : Object.freeze(
              Object.fromEntries(
                Object.entries(input).map(([key, ref]) => [key, checkedReference(valueOf(ref), owner)]),
              ),
            )
      if (!(refs instanceof RuntimeReference) && Object.keys(refs).length === 0)
        throw new TypeError('on requires a nonempty reference record')
      const selected = refs instanceof RuntimeReference ? [refs] : Object.values(refs)
      if (selected.some((ref) => ref.source.kind === 'error')) throw new TypeError('error data requires ofType')
      if (selected.some((ref) => ref.source.kind === 'outcome'))
        throw new TypeError('raw outcome requires kind, withError or project')
      return Object.freeze({
        satisfies(name: string, predicate: object) {
          if (typeof name !== 'string' || name.trim().length === 0 || typeof predicate !== 'function')
            throw new TypeError('satisfies requires a name and synchronous predicate')
          return new Condition(owner, { kind: 'predicate', refs, name, predicate })
        },
      })
    },
    project(input: object, project: object) {
      if (typeof project !== 'function') throw new TypeError('project requires a function')
      if (checkedReference(input, owner).source.kind === 'error')
        throw new TypeError('error projection requires ofType')
      return reference(owner, { kind: 'project', parent: checkedReference(input, owner), project })
    },
    identity(input: object) {
      return reference(owner, { kind: 'identity', parent: checkedReference(input, owner) })
    },
  }
  if (mode === 'pure') return Object.freeze(api)
  return Object.freeze({
    ...api,
    state<Q extends AnyFn>(token: State<Q>, ...args: RefArguments<Parameters<Q>>) {
      return new StateSubject(owner, checkedReference(stateReference(owner, token, args), owner).source)
    },
    action<E>(token: Action<E>) {
      return Object.freeze({
        untilTargetSettles: () =>
          new ActionSubject(owner, checkedReference(actionReference(owner, token, { kind: 'settled' }), owner).source),
        forAfterTarget: (milliseconds: number) =>
          new ActionSubject(
            owner,
            checkedReference(actionReference(owner, token, { kind: 'after', milliseconds }), owner).source,
          ),
      })
    },
  })
}
