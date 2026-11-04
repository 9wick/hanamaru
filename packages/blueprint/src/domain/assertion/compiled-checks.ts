import type { Value } from '../definition/javascript.js'
import { arrayValue } from '../definition/javascript.js'
import { ObservationOwner, checkedState, checkedAction } from '../definition/observation.js'
import type { Characteristic } from '../definition/runtime.js'
import { captureAdaptedValue } from './value-adapter.js'
import { captureValue } from './value-image.js'
import type { ValueImage } from './value-image.js'
import { RuntimeReference, checkedReference, referenceGraph, referenceTermination } from './references.js'
import type { TerminationRequirement } from './references.js'

export type Check =
  | {
      readonly kind: 'equal'
      readonly ref: RuntimeReference
      readonly expected: ValueImage
      readonly adapter: object | null
    }
  | { readonly kind: 'identity'; readonly ref: RuntimeReference; readonly expected: Value }
  | {
      readonly kind: 'close'
      readonly ref: RuntimeReference
      readonly expected: number
      readonly absoluteTolerance: number
    }
  | {
      readonly kind: 'predicate'
      readonly refs: RuntimeReference | Readonly<Record<string, RuntimeReference>>
      readonly name: string
      readonly predicate: object
    }
  | { readonly kind: 'unchanged'; readonly before: RuntimeReference; readonly after: RuntimeReference }
  | { readonly kind: 'count'; readonly ref: RuntimeReference; readonly expected: number }

declare const conditionType: unique symbol
export type ConditionRequirement = TerminationRequirement | 'neutral'
export class Condition<R extends ConditionRequirement = ConditionRequirement> {
  declare readonly [conditionType]: R
  readonly owner: ObservationOwner
  readonly check: Check
  constructor(owner: ObservationOwner, check: Check) {
    owner.assertOpen()
    this.owner = owner
    this.check = Object.freeze(check)
    Object.freeze(this)
  }
}

export function equalCondition<R extends ConditionRequirement = ConditionRequirement>(
  owner: ObservationOwner,
  ref: RuntimeReference,
  expected: Value,
  adapter: object | null = null,
): Condition<R> {
  checkedReference(ref, owner)
  return new Condition<R>(owner, {
    kind: 'equal',
    ref,
    expected: captureValue(adapter === null ? expected : captureAdaptedValue(adapter, expected)),
    adapter,
  })
}
export function closeCondition<R extends ConditionRequirement = ConditionRequirement>(
  owner: ObservationOwner,
  ref: RuntimeReference,
  expected: number,
  absoluteTolerance: number,
): Condition<R> {
  checkedReference(ref, owner)
  if (!Number.isFinite(expected) || !Number.isFinite(absoluteTolerance) || absoluteTolerance < 0)
    throw new TypeError('toBeCloseTo requires a finite expected value and nonnegative finite tolerance')
  return new Condition<R>(owner, { kind: 'close', ref, expected, absoluteTolerance })
}
export function checkReferences(check: Check): readonly RuntimeReference[] {
  switch (check.kind) {
    case 'predicate':
      return check.refs instanceof RuntimeReference
        ? [checkedReference(check.refs, check.refs.owner)]
        : Object.values(check.refs)
    case 'unchanged':
      return [check.before, check.after]
    default:
      return [check.ref]
  }
}

export interface CompiledChecks {
  readonly conditions: readonly Condition[]
  readonly references: readonly RuntimeReference[]
  readonly termination: TerminationRequirement
}

export function compileChecks(
  input: Value,
  owner: ObservationOwner,
  characteristic: Characteristic,
  caseKind: 'example' | 'property',
): CompiledChecks {
  const conditions = arrayValue(input).map((value) => {
    if (!(value instanceof Condition) || value.owner !== owner)
      throw new TypeError('expect requires conditions from this evaluation')
    if (value.check.kind === 'predicate' && typeof value.check.predicate !== 'function')
      throw new TypeError('property requires a predicate function')
    if (value.check.kind === 'count' && value.check.ref.source.kind !== 'action')
      throw new TypeError('count requires an action observation')
    if (value.check.kind === 'count' && (!Number.isSafeInteger(value.check.expected) || value.check.expected < 0))
      throw new TypeError('action count must be a nonnegative safe integer')
    if (caseKind === 'example' && value.check.kind === 'predicate')
      throw new TypeError('properties cannot be checked inside it')
    return value
  })
  if (!conditions.length) throw new TypeError('expect requires at least one condition')
  const roots = conditions.flatMap((condition) => checkReferences(condition.check))
  const refs = referenceGraph(roots, owner)
  const windows = new Map<object, string>()
  for (const ref of refs) {
    const source = ref.source
    if ((source.kind === 'state' || source.kind === 'action') && characteristic !== 'effectful')
      throw new TypeError('observations require an effectful target')
    if (source.kind === 'state') {
      checkedState(source.token, owner)
      if (
        source.timing.kind === 'after-step' &&
        referenceGraph([source.timing.step], owner).some(
          (parent) => !['step', 'field', 'alias'].includes(parent.source.kind),
        )
      )
        throw new TypeError('after requires a single operation result reference')
      const checkpoint =
        source.timing.kind === 'after-step'
          ? referenceGraph([source.timing.step], owner).find((parent) => parent.source.kind === 'step')?.source
          : null
      if (source.timing.kind === 'after-step' && (checkpoint?.kind !== 'step' || checkpoint.terminal))
        throw new TypeError('after requires a successful non-final step')
      for (const arg of source.args) {
        if (arg.kind !== 'reference') continue
        for (const dependency of referenceGraph([arg.ref], owner)) {
          const origin = dependency.source
          if (['state', 'action', 'error', 'outcome', 'identity'].includes(origin.kind))
            throw new TypeError('state arguments must use input, sample, values or normal results')
          if (
            checkpoint?.kind === 'step' &&
            (origin.kind === 'result' || (origin.kind === 'step' && origin.operation > checkpoint.operation))
          )
            throw new TypeError('observation arguments are not available at this checkpoint')
          if (source.timing.kind === 'before' && (origin.kind === 'result' || origin.kind === 'step'))
            throw new TypeError('before observations cannot depend on results')
        }
      }
    }
    if (source.kind === 'action') {
      checkedAction(source.token, owner)
      const window = source.window.kind === 'settled' ? 'settled' : `after:${source.window.milliseconds}`
      const previous = windows.get(source.token)
      if (previous !== undefined && previous !== window) throw new TypeError('action has conflicting recording windows')
      windows.set(source.token, window)
    }
    if (source.kind === 'identity') {
      const parents = referenceGraph([source.parent], owner)
      if (
        parents.some((parent) =>
          ['state', 'action', 'sample', 'project', 'error', 'outcome', 'record'].includes(parent.source.kind),
        )
      )
        throw new TypeError('identity requires a live input, result or constant reference')
    }
  }
  for (const condition of conditions) {
    if (
      condition.check.kind === 'identity' &&
      referenceGraph([condition.check.ref], owner).some((ref) =>
        ['state', 'action', 'sample', 'project', 'record'].includes(ref.source.kind),
      )
    )
      throw new TypeError('reference identity cannot be checked on captured observations')
    if (condition.check.kind !== 'predicate') continue
    const dependencies = referenceGraph(checkReferences(condition.check), owner)
    if (
      dependencies.some(
        (ref) => ref.source.kind === 'state' && ref.source.timing.kind === 'after-plan' && ref.source.timing.wait,
      )
    )
      throw new TypeError('eventually observations cannot be predicate inputs')
    if (
      !dependencies.some(
        (ref) =>
          ['result', 'error', 'outcome', 'step', 'action'].includes(ref.source.kind) ||
          (ref.source.kind === 'state' && ref.source.timing.kind !== 'before'),
      )
    )
      throw new TypeError('a property must observe a result or post-execution effect')
  }
  return Object.freeze({
    conditions: Object.freeze(conditions),
    references: refs,
    termination: referenceTermination(roots, owner),
  })
}

export type ContractConditions =
  | readonly [Condition<'return' | 'neutral'>, ...Condition<'return' | 'neutral'>[]]
  | readonly [Condition<'throw' | 'neutral'>, ...Condition<'throw' | 'neutral'>[]]
  | readonly [Condition<'return-or-throw' | 'neutral'>, ...Condition<'return-or-throw' | 'neutral'>[]]
