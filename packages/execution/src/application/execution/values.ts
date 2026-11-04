import { ObservationFault, observationResult } from './observation-fault.js'
import { diagnostic } from '../../domain/result/diagnostic.js'
import type { DiagnosticValue, ObservationResult } from '../../domain/result/types.js'
import {
  captureAdaptedValue,
  captureValue,
  recordImage,
  checkReferences,
  copyData,
  equalValues,
  RuntimeReference,
} from '@hanamaru/blueprint/model'
import type { Check, CompiledChecks, ValueImage } from '@hanamaru/blueprint/model'
import type { Value } from '../../domain/execution/javascript.js'
import { functionValue, invoke, objectValue, property, valueOf } from '../../domain/execution/javascript.js'

type Result<T> =
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'mismatch'; readonly reason: string; readonly actual: DiagnosticValue }
  | { readonly kind: 'error'; readonly cause: Value }
  | { readonly kind: 'missing'; readonly reason: string }
interface Capture {
  readonly raw: Result<Value>
  readonly images: Map<object | null, Result<ValueImage>>
  readonly data: Result<Value> | null
}
export type CheckEvaluation =
  | { readonly status: 'passed' }
  | { readonly status: 'failed'; readonly reason: string }
  | { readonly status: 'error'; readonly phase: 'observe' | 'assert'; readonly cause: Value }
  | { readonly status: 'not-evaluated'; readonly reason: string; readonly pending?: true }

function captured<T>(read: () => T): Result<T> {
  try {
    return { kind: 'value', value: read() }
  } catch (cause) {
    return { kind: 'error', cause: valueOf(cause) }
  }
}

export class CaptureFailure extends Error {
  readonly causes: readonly Value[]
  constructor(causes: readonly Value[]) {
    super('value capture failed', { cause: causes[0] })
    this.causes = causes
  }
}

/** 評価内の実測値。比較表現・述語データ・生参照はそれぞれ必要な取得時点に保持する。 */
export class EvaluationValues {
  readonly #compiled: CompiledChecks
  readonly #values = new Map<RuntimeReference, Capture>()
  readonly #images = new Map<RuntimeReference, Set<object | null>>()
  readonly #data = new Set<RuntimeReference>()
  readonly #countRefs = new Set<RuntimeReference>()
  readonly #counts = new Map<RuntimeReference, Result<number>>()
  readonly #identities = new Map<Value, object>()
  readonly #negativeZero = Object.freeze({})
  readonly #observation: ((ref: RuntimeReference) => ObservationResult) | undefined
  #exit: 'return' | 'throw' | null = null
  ended(kind: 'return' | 'throw' | null): void {
    this.#exit = kind
  }
  #unavailable(ref: RuntimeReference): string {
    const source = ref.source
    if ('parent' in source) return this.#unavailable(source.parent)
    if (source.kind === 'step') return `operation ${source.operation + 1} did not produce a normal result`
    if (source.kind === 'result')
      return this.#exit === 'throw'
        ? 'target threw instead of returning a result'
        : 'target did not produce a normal result'
    if (source.kind === 'error')
      return this.#exit === 'return'
        ? 'target returned instead of throwing'
        : 'target did not produce an expected exception'
    if (source.kind === 'state') {
      for (const arg of source.args)
        if (arg.kind === 'reference' && this.raw(arg.ref).kind === 'missing')
          return `state argument unavailable: ${this.#unavailable(arg.ref)}`
    }
    return `${source.kind} value was not produced`
  }
  constructor(
    compiled: CompiledChecks,
    options: {
      readonly initializeConstants?: boolean
      readonly observation?: (ref: RuntimeReference) => ObservationResult
    } = {},
  ) {
    this.#compiled = compiled
    this.#observation = options.observation
    for (const condition of compiled.conditions) {
      const check = condition.check
      if (check.kind === 'count') this.#countRefs.add(check.ref)
      if (check.kind === 'predicate') for (const ref of checkReferences(check)) this.#data.add(ref)
      if (check.kind === 'equal') this.#imageFor(check.ref, check.adapter)
      if (check.kind === 'unchanged') {
        this.#imageFor(check.before, null)
        this.#imageFor(check.after, null)
      }
    }
    for (const ref of compiled.references)
      if (ref.source.kind === 'state')
        for (const arg of ref.source.args) if (arg.kind === 'reference') this.#data.add(arg.ref)
    for (const ref of this.#data)
      if (ref.source.kind === 'record') for (const child of Object.values(ref.source.fields)) this.#data.add(child)
    for (const ref of options.initializeConstants === false ? [] : compiled.references)
      if (ref.source.kind === 'value') this.#save(ref, { kind: 'value', value: ref.source.value })
    this.#derive()
  }
  #imageFor(ref: RuntimeReference, adapter: object | null): void {
    if (ref.source.kind === 'record' && adapter === null)
      for (const child of Object.values(ref.source.fields)) this.#imageFor(child, null)
    let set = this.#images.get(ref)
    if (!set) {
      set = new Set()
      this.#images.set(ref, set)
    }
    set.add(adapter)
  }
  #capture<T>(ref: RuntimeReference, read: () => T): Result<T> {
    const result = captured(read)
    if (result.kind !== 'error' || result.cause instanceof ObservationFault) return result
    let origin = ref
    while ('parent' in origin.source) origin = origin.source.parent
    const source = origin.source
    if (source.kind !== 'state' && source.kind !== 'action') return result
    const stage = source.kind === 'action' ? 'finish' : source.timing.kind === 'before' ? 'before' : 'after'
    return {
      kind: 'error',
      cause: new ObservationFault(this.#observation?.(origin) ?? observationResult(origin, this), stage, result.cause),
    }
  }
  #save(ref: RuntimeReference, raw: Result<Value>): void {
    if (this.#countRefs.has(ref))
      this.#counts.set(
        ref,
        raw.kind !== 'value'
          ? raw
          : Array.isArray(raw.value)
            ? { kind: 'value', value: raw.value.length }
            : { kind: 'error', cause: new TypeError('action must produce an array') },
      )
    const images = new Map<object | null, Result<ValueImage>>()
    for (const adapter of this.#images.get(ref) ?? [])
      images.set(
        adapter,
        raw.kind === 'value'
          ? this.#capture(ref, () =>
              captureValue(adapter === null ? raw.value : captureAdaptedValue(adapter, raw.value)),
            )
          : raw,
      )
    const data = this.#data.has(ref)
      ? raw.kind === 'value'
        ? this.#capture(ref, () => (ref.source.kind === 'identity' ? raw.value : copyData(raw.value)))
        : raw
      : null
    this.#values.set(ref, { raw, images, data })
  }
  captureFailure(ref: RuntimeReference): { readonly cause: Value } | undefined {
    const capture = this.#values.get(ref)
    if (!capture) return undefined
    for (const value of [capture.raw, capture.data, ...capture.images.values()])
      if (value?.kind === 'error') return { cause: value.cause }
    return undefined
  }
  assertCaptured(): void {
    const causes = new Set<Value>()
    for (const capture of this.#values.values()) {
      for (const result of [capture.raw, capture.data, ...capture.images.values()])
        if (result?.kind === 'error') causes.add(result.cause)
    }
    if (causes.size) throw new CaptureFailure([...causes])
  }
  supply(ref: RuntimeReference, value: Value): void {
    if (!this.#compiled.references.includes(ref)) throw new TypeError('reference is not in this evaluation')
    ref.owner.assertOpen()
    if (this.#values.has(ref)) throw new TypeError('reference was already captured')
    this.#save(ref, { kind: 'value', value })
    this.#derive()
  }
  reject(ref: RuntimeReference, cause: Value): void {
    if (!this.#compiled.references.includes(ref)) throw new TypeError('reference is not in this evaluation')
    ref.owner.assertOpen()
    if (this.#values.has(ref)) throw new TypeError('reference was already captured')
    this.#save(ref, { kind: 'error', cause })
    this.#derive()
  }
  raw(ref: RuntimeReference): Result<Value> {
    return this.#values.get(ref)?.raw ?? { kind: 'missing', reason: this.#unavailable(ref) }
  }
  image(ref: RuntimeReference, adapter: object | null = null): Result<ValueImage> {
    return this.#values.get(ref)?.images.get(adapter) ?? { kind: 'missing', reason: this.#unavailable(ref) }
  }
  count(ref: RuntimeReference): Result<number> {
    return this.#counts.get(ref) ?? { kind: 'missing', reason: 'action count was not captured' }
  }
  data(ref: RuntimeReference): Result<Value> {
    return this.#values.get(ref)?.data ?? { kind: 'missing', reason: this.#unavailable(ref) }
  }
  #record(
    fields: readonly (readonly [string, RuntimeReference])[],
    read: (ref: RuntimeReference) => Result<Value>,
  ): Result<Value> {
    const entries: [string, Value][] = []
    for (const [key, child] of fields) {
      const value = read(child)
      if (value.kind !== 'value') return value
      entries.push([key, value.value])
    }
    return { kind: 'value', value: Object.fromEntries(entries) }
  }
  #derive(): void {
    for (const ref of this.#compiled.references) {
      if (this.#values.has(ref)) continue
      if (ref.source.kind === 'record') {
        const fields = Object.entries(ref.source.fields)
        if (fields.some(([, child]) => !this.#values.has(child))) continue
        const raw = this.#record(fields, (child) => this.raw(child))
        this.#save(ref, raw)
        const stored = this.#values.get(ref)
        if (!stored) throw new TypeError('record capture was not stored')
        if (this.#images.get(ref)?.has(null))
          stored.images.set(
            null,
            captured(() => {
              const images: [string, ValueImage][] = []
              for (const [key, child] of fields) {
                const image = this.image(child)
                if (image.kind === 'error') throw image.cause
                if (image.kind !== 'value') throw new TypeError('step comparison image is unavailable')
                images.push([key, image.value])
              }
              return recordImage(Object.fromEntries(images))
            }),
          )
        if (this.#data.has(ref))
          this.#values.set(ref, { ...stored, data: this.#record(fields, (child) => this.data(child)) })
        continue
      }
      if (!('parent' in ref.source)) continue
      const source = ref.source,
        parent = this.#values.get(source.parent)
      if (!parent) continue
      if (parent.raw.kind !== 'value') {
        this.#save(ref, parent.raw)
        continue
      }
      const value = parent.raw.value
      let derived: Result<Value>
      if (source.kind === 'alias') derived = { kind: 'value', value }
      else if (source.kind === 'field') {
        if (value === null || value === undefined)
          derived = { kind: 'mismatch', reason: 'property path is missing', actual: { kind: 'missing' } }
        else
          derived = captured(() => {
            const receiver = objectValue(valueOf(Object(value)))
            if (!Reflect.has(receiver, source.key)) throw new MissingProperty()
            return property(receiver, source.key)
          })
        if (derived.kind === 'error' && derived.cause instanceof MissingProperty)
          derived = { kind: 'mismatch', reason: 'property path is missing', actual: { kind: 'missing' } }
      } else if (source.kind === 'project') derived = captured(() => invoke(source.project, undefined, [value]))
      else if (source.kind === 'identity') {
        const key = Object.is(value, -0) ? this.#negativeZero : value
        let token = this.#identities.get(key)
        if (!token) {
          token = Object.freeze({})
          this.#identities.set(key, token)
        }
        derived = { kind: 'value', value: token }
      } else if (source.kind === 'error-type') {
        const match = captured(() => value instanceof functionValue(source.ctor))
        derived =
          match.kind !== 'value'
            ? match
            : match.value
              ? { kind: 'value', value }
              : { kind: 'mismatch', reason: 'exception type does not match', actual: diagnostic(value) }
      } else {
        const branch = captured(() => property(value, 'kind'))
        if (branch.kind !== 'value') derived = branch
        else if (branch.value === 'return')
          derived = captured(() => ({ kind: 'return', value: property(value, 'value') }))
        else if (branch.value !== 'throw') derived = { kind: 'error', cause: new TypeError('invalid target outcome') }
        else {
          const error = captured(() => property(value, 'error'))
          if (error.kind !== 'value') derived = error
          else {
            const match = captured(() => error.value instanceof functionValue(source.ctor))
            derived =
              match.kind !== 'value'
                ? match
                : match.value
                  ? captured(() => ({
                      kind: 'throw',
                      error: source.project === null ? null : invoke(source.project, undefined, [error.value]),
                    }))
                  : { kind: 'mismatch', reason: 'exception type does not match', actual: diagnostic(error.value) }
          }
        }
      }
      if (derived.kind === 'error') {
        const cause = derived.cause
        derived = this.#capture(ref, () => {
          throw cause
        })
      }
      this.#save(ref, derived)
    }
  }
}
class MissingProperty extends Error {}

function mapResult(result: Result<boolean>, phase: 'observe' | 'assert'): CheckEvaluation {
  switch (result.kind) {
    case 'value':
      return result.value ? { status: 'passed' } : { status: 'failed', reason: 'condition did not match' }
    case 'mismatch':
      return { status: 'failed', reason: result.reason }
    case 'error':
      return { status: 'error', phase, cause: result.cause }
    case 'missing':
      return { status: 'not-evaluated', reason: result.reason }
  }
}
export function evaluateCheck(check: Check, values: EvaluationValues): CheckEvaluation {
  let result: Result<boolean>
  let phase: 'observe' | 'assert' = 'observe'
  if (check.kind === 'equal') {
    const actual = values.image(check.ref, check.adapter)
    result = actual.kind === 'value' ? captured(() => equalValues(actual.value, check.expected)) : actual
  } else if (check.kind === 'unchanged') {
    const before = values.image(check.before),
      after = values.image(check.after)
    result =
      before.kind !== 'value'
        ? before
        : after.kind !== 'value'
          ? after
          : captured(() => equalValues(before.value, after.value))
  } else if (check.kind === 'count') {
    const actual = values.count(check.ref)
    result = actual.kind === 'value' ? { kind: 'value', value: actual.value === check.expected } : actual
  } else if (check.kind === 'predicate') {
    let input: Result<Value>
    if (check.refs instanceof RuntimeReference) input = values.data(check.refs)
    else {
      const fields: [string, Value][] = []
      input = { kind: 'value', value: undefined }
      for (const [key, ref] of Object.entries(check.refs)) {
        const value = values.data(ref)
        if (value.kind !== 'value') {
          input = value
          break
        }
        fields.push([key, value.value])
      }
      if (input.kind === 'value') input = { kind: 'value', value: Object.fromEntries(fields) }
    }
    if (input.kind === 'value') phase = 'assert'
    result =
      input.kind !== 'value'
        ? input
        : captured(() => {
            const returned = invoke(check.predicate, undefined, [copyData(input.value)])
            if (typeof returned !== 'boolean')
              throw new TypeError('property predicate must return a synchronous boolean')
            return returned
          })
  } else {
    const actual = values.raw(check.ref)
    result =
      actual.kind !== 'value'
        ? actual
        : captured(() => {
            if (check.kind === 'identity') return Object.is(actual.value, check.expected)
            return (
              typeof actual.value === 'number' &&
              Number.isFinite(actual.value) &&
              Math.abs(actual.value - check.expected) <= check.absoluteTolerance
            )
          })
  }
  return mapResult(result, phase)
}
