import { copyData } from '../definition/data-copy.js'
import type { AnyFn } from '../definition/target-types.js'
import type { Action, State } from '../definition/observation.js'
import {
  ActionDescriptor,
  ObservationOwner,
  StateDescriptor,
  checkedAction,
  checkedState,
} from '../definition/observation.js'
import type { Value } from '../definition/javascript.js'
import { arrayValue } from '../definition/javascript.js'

export const referenceType = Symbol('hanamaru reference type')
export type ReferenceOrigin =
  | 'input'
  | 'sample'
  | 'result'
  | 'error'
  | 'outcome'
  | 'value'
  | 'state'
  | 'action'
  | 'project'
  | 'identity'
  | 'step'
  | 'record'
  | 'final-record'
export type ReferenceMode = 'live' | 'snapshot'
export type ReferenceModeOf<O extends ReferenceOrigin> = O extends
  | 'sample'
  | 'state'
  | 'action'
  | 'project'
  | 'record'
  | 'final-record'
  ? 'snapshot'
  : 'live'
export interface Ref<T, O extends ReferenceOrigin = ReferenceOrigin, P extends ReferenceMode = ReferenceModeOf<O>> {
  readonly [referenceType]: { readonly value: T; readonly origin: O; readonly representation: P }
  field<K extends keyof NonNullable<T>>(key: K): Ref<NonNullable<T>[K], O, P>
}
export type RefArguments<A extends readonly unknown[]> = { [K in keyof A]: A[K] | Ref<A[K]> }
export type RefArgument =
  | { readonly kind: 'value'; readonly value: Value }
  | { readonly kind: 'reference'; readonly ref: RuntimeReference }
export type StateTiming =
  | { readonly kind: 'before' }
  | { readonly kind: 'after-plan'; readonly wait?: { readonly withinMs: number; readonly intervalMs: number } }
  | { readonly kind: 'after-step'; readonly step: RuntimeReference }
export type ActionWindow = { readonly kind: 'settled' } | { readonly kind: 'after'; readonly milliseconds: number }
export type ReferenceSource =
  | { readonly kind: 'record'; readonly fields: Readonly<Record<string, RuntimeReference>> }
  | { readonly kind: 'input' | 'sample'; readonly index: number }
  | { readonly kind: 'result' | 'error' | 'outcome' }
  | { readonly kind: 'step'; readonly operation: number; readonly terminal: boolean }
  | { readonly kind: 'value'; readonly value: Value }
  | { readonly kind: 'field'; readonly parent: RuntimeReference; readonly key: PropertyKey }
  | { readonly kind: 'alias'; readonly parent: RuntimeReference; readonly key: PropertyKey }
  | {
      readonly kind: 'state'
      readonly token: StateDescriptor
      readonly args: readonly RefArgument[]
      readonly timing: StateTiming
    }
  | { readonly kind: 'action'; readonly token: ActionDescriptor; readonly window: ActionWindow }
  | { readonly kind: 'project'; readonly parent: RuntimeReference; readonly project: object }
  | { readonly kind: 'identity'; readonly parent: RuntimeReference }
  | { readonly kind: 'error-type'; readonly parent: RuntimeReference; readonly ctor: object }
  | {
      readonly kind: 'outcome-error'
      readonly parent: RuntimeReference
      readonly ctor: object
      readonly project: object | null
    }

/** 実測値は保持しない。評価所有者と依存のグラフだけを定義する。 */
export class RuntimeReference {
  readonly owner: ObservationOwner
  readonly id: number
  readonly source: ReferenceSource
  constructor(owner: ObservationOwner, source: ReferenceSource) {
    this.owner = owner
    this.id = owner.allocate()
    this.source = Object.freeze(source)
    Object.freeze(this)
  }
  [Symbol.toPrimitive](): never {
    throw new TypeError('references are not measured values')
  }
}
class Reference<T, O extends ReferenceOrigin, P extends ReferenceMode>
  extends RuntimeReference
  implements Ref<T, O, P>
{
  declare readonly [referenceType]: { readonly value: T; readonly origin: O; readonly representation: P }
  field<K extends keyof NonNullable<T>>(key: K): Ref<NonNullable<T>[K], O, P> {
    this.owner.assertOpen()
    return new Reference(this.owner, { kind: 'field', parent: this, key })
  }
}
export function reference<T, O extends ReferenceOrigin, P extends ReferenceMode = ReferenceModeOf<O>>(
  owner: ObservationOwner,
  source: ReferenceSource,
): Ref<T, O, P> {
  return new Reference(owner, source)
}
export function checkedReference(value: Value, owner: ObservationOwner): RuntimeReference {
  owner.assertOpen()
  if (!(value instanceof RuntimeReference)) throw new TypeError('expected a reference produced by this case')
  if (value.owner !== owner) throw new TypeError('reference belongs to another evaluation')
  return value
}
export function indexedReference<T, O extends 'input' | 'sample'>(
  owner: ObservationOwner,
  kind: O,
  index: number,
): Ref<T, O> {
  if (!Number.isSafeInteger(index) || index < 0)
    throw new TypeError('reference index must be a nonnegative safe integer')
  return reference(owner, { kind, index })
}
export function stateReference<F extends AnyFn>(
  owner: ObservationOwner,
  token: State<F>,
  args: RefArguments<Parameters<F>>,
): Ref<Awaited<ReturnType<F>>, 'state'> {
  const state = checkedState(token, owner)
  const parameters: RefArgument[] = arrayValue(args).map((value) =>
    value instanceof RuntimeReference
      ? { kind: 'reference', ref: checkedReference(value, owner) }
      : { kind: 'value', value: copyData(value) },
  )
  return reference(owner, {
    kind: 'state',
    token: state,
    args: Object.freeze(parameters),
    timing: { kind: 'after-plan' },
  })
}
export function actionReference<E>(
  owner: ObservationOwner,
  token: Action<E>,
  window: ActionWindow,
): Ref<readonly E[], 'action'> {
  if (window.kind === 'after' && (!Number.isFinite(window.milliseconds) || window.milliseconds <= 0))
    throw new TypeError('action interval must be positive and finite')
  return reference(owner, { kind: 'action', token: checkedAction(token, owner), window: Object.freeze({ ...window }) })
}

export function referenceParents(ref: RuntimeReference): readonly RuntimeReference[] {
  const source = ref.source
  if (source.kind === 'record') return Object.values(source.fields)
  if ('parent' in source) return [source.parent]
  if (source.kind !== 'state') return []
  return [
    ...source.args.flatMap((arg) => (arg.kind === 'reference' ? [arg.ref] : [])),
    ...(source.timing.kind === 'after-step' ? [source.timing.step] : []),
  ]
}
export function referenceGraph(
  roots: readonly RuntimeReference[],
  owner: ObservationOwner,
): readonly RuntimeReference[] {
  const seen = new Set<RuntimeReference>(),
    visiting = new Set<RuntimeReference>()
  const ordered: RuntimeReference[] = []
  function visit(ref: RuntimeReference): void {
    checkedReference(ref, owner)
    if (visiting.has(ref)) throw new TypeError('cyclic reference dependency')
    if (seen.has(ref)) return
    visiting.add(ref)
    referenceParents(ref).forEach(visit)
    visiting.delete(ref)
    seen.add(ref)
    ordered.push(ref)
  }
  roots.forEach(visit)
  return ordered
}

export type TerminationRequirement = 'return' | 'throw' | 'return-or-throw'
/** 未解決のsteps結果の参照先は、操作計画を結び付けてからこの検査に渡す。 */
export function referenceTermination(
  refs: readonly RuntimeReference[],
  owner: ObservationOwner,
): TerminationRequirement {
  const kinds = new Set<TerminationRequirement>()
  for (const ref of referenceGraph(refs, owner)) {
    switch (ref.source.kind) {
      case 'result':
        kinds.add('return')
        break
      case 'error':
        kinds.add('throw')
        break
      case 'outcome':
        kinds.add('return-or-throw')
        break
      case 'step':
        if (ref.source.terminal) kinds.add('return')
        break
    }
  }
  if (kinds.size > 1) throw new TypeError('normal result, error and outcome expectations cannot be mixed')
  if (kinds.has('throw')) return 'throw'
  if (kinds.has('return-or-throw')) return 'return-or-throw'
  return 'return'
}
