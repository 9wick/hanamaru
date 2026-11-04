import type { AnyFn } from './target-types.js'
import type { Value } from './javascript.js'
import { invoke, valueOf } from './javascript.js'
import { ObservationOwner } from './observation.js'
import { RuntimeReference, checkedReference, referenceGraph, referenceType } from '../assertion/references.js'
import type { Ref } from '../assertion/references.js'

declare const callType: unique symbol
declare const finalType: unique symbol
export interface CallRef<T> extends Ref<T, 'step'> {
  readonly [callType]: T
  field<K extends keyof NonNullable<T>>(key: K): CallRef<NonNullable<T>[K]>
}
export interface FinalStepRef<T> {
  readonly [finalType]: T
}
export type StepArguments<A extends readonly unknown[]> = { [K in keyof A]: A[K] | CallRef<A[K]> }
export interface StepOperation<F extends AnyFn> {
  args(...args: StepArguments<Parameters<F>>): CallRef<Awaited<ReturnType<F>>>
  final(...args: StepArguments<Parameters<F>>): FinalStepRef<Awaited<ReturnType<F>>>
}
export type StepOutput =
  | CallRef<unknown>
  | FinalStepRef<unknown>
  | Readonly<Record<string, CallRef<unknown> | FinalStepRef<unknown>>>
export type StepValue<O> = O extends CallRef<infer V> | FinalStepRef<infer V>
  ? V
  : { [K in keyof O]: O[K] extends CallRef<infer V> | FinalStepRef<infer V> ? V : never }
export type NonemptySteps<O> = keyof O extends never ? never : O
export type StepScope<M extends Record<string, AnyFn>, C, S extends readonly unknown[] | null> = {
  readonly [K in keyof M]: StepOperation<M[K]>
} & { readonly ctx: Readonly<C> } & (S extends null ? {} : { readonly input: S })

class StepCall<T> extends RuntimeReference implements CallRef<T> {
  declare readonly [referenceType]: { readonly value: T; readonly origin: 'step'; readonly representation: 'live' }
  declare readonly [callType]: T
  field<K extends keyof NonNullable<T>>(key: K): CallRef<NonNullable<T>[K]> {
    return new StepCall(this.owner, { kind: 'field', parent: this, key })
  }
}
class FinalStep<T> extends RuntimeReference implements FinalStepRef<T> {
  declare readonly [finalType]: T
}
export interface PlannedStep {
  readonly index: number
  readonly key: string
  readonly final: boolean
  readonly args: readonly (
    | { readonly kind: 'literal'; readonly value: Value }
    | { readonly kind: 'reference'; readonly ref: RuntimeReference }
  )[]
  readonly ref: RuntimeReference
}
export interface StepPlan {
  readonly operations: readonly PlannedStep[]
  readonly output: RuntimeReference | Readonly<Record<string, RuntimeReference>>
  readonly final: PlannedStep | null
}

/** compileは操作を記録するだけで、targetを呼ばずに順序と参照の所属を検査する。 */
export function compileSteps(
  owner: ObservationOwner,
  keys: readonly string[],
  build: object,
  ctx: object,
  sample: readonly Value[] | null,
): StepPlan {
  const operations: PlannedStep[] = []
  let active = true
  let terminal: PlannedStep | null = null
  function record(key: string, final: boolean, args: readonly Value[]): RuntimeReference {
    if (!active) throw new TypeError('step operations are only available during compile')
    if (terminal !== null) throw new TypeError('final must be the last operation and may appear only once')
    const parameters: PlannedStep['args'] = args.map((value) => {
      if (!(value instanceof RuntimeReference)) return { kind: 'literal', value }
      const ref = checkedReference(value, owner)
      if (!(ref instanceof StepCall)) throw new TypeError('step arguments require preceding call references')
      const ancestors = referenceGraph([ref], owner)
      if (
        !ancestors.some(
          (parent) => parent.source.kind === 'step' && operations.some((operation) => operation.ref === parent),
        )
      )
        throw new TypeError('step reference belongs to another plan')
      return { kind: 'reference', ref }
    })
    const index = operations.length
    const source = { kind: 'step', operation: index, terminal: final } as const
    const ref = final ? new FinalStep(owner, source) : new StepCall(owner, source)
    const operation = Object.freeze({ index, key, final, args: Object.freeze(parameters), ref })
    operations.push(operation)
    if (final) terminal = operation
    return ref
  }
  if (keys.some((key) => key === 'ctx' || key === 'input'))
    throw new TypeError('scenario keys conflict with step context')
  const scope = Object.freeze({
    ...Object.fromEntries(
      keys.map((key) => [
        key,
        Object.freeze({
          args: (...args: Value[]) => record(key, false, args),
          final: (...args: Value[]) => record(key, true, args),
        }),
      ]),
    ),
    ctx,
    ...(sample === null ? {} : { input: sample }),
  })
  let output: Value
  try {
    output = invoke(build, undefined, [scope])
  } finally {
    active = false
  }
  function selected(value: Value): RuntimeReference {
    const ref = checkedReference(value, owner)
    if (!(ref instanceof StepCall) && !(ref instanceof FinalStep))
      throw new TypeError('steps must return call references')
    if (!referenceGraph([ref], owner).some((parent) => operations.some((operation) => operation.ref === parent)))
      throw new TypeError('returned step belongs to another plan')
    return ref
  }
  const result =
    output instanceof RuntimeReference
      ? selected(output)
      : (() => {
          if (output === null || typeof output !== 'object' || Array.isArray(output))
            throw new TypeError('steps require a reference or nonempty flat record')
          const fields = Reflect.ownKeys(output).map((key): [string, RuntimeReference] => {
            const descriptor = Object.getOwnPropertyDescriptor(output, key)
            if (typeof key !== 'string' || !descriptor || !('value' in descriptor))
              throw new TypeError('step result must be a flat data record')
            return [key, selected(valueOf(descriptor.value))]
          })
          if (!fields.length) throw new TypeError('steps require a nonempty result')
          return Object.freeze(Object.fromEntries(fields))
        })()
  const roots = result instanceof RuntimeReference ? [result] : Object.values(result)
  const final = operations.find((operation) => operation.final) ?? null
  if (final !== null && !roots.includes(final.ref))
    throw new TypeError('final must be returned directly or as a result field')
  if (!operations.length) throw new TypeError('steps require at least one operation')
  return Object.freeze({ operations: Object.freeze(operations), output: result, final })
}
