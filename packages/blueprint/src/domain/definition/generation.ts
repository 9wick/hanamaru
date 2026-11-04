import { copyData } from './data-copy.js'
import { arrayValue, property, required } from './javascript.js'
import type { Value } from './javascript.js'

declare const generatedType: unique symbol
export interface Arbitrary<T = Value> {
  readonly kind: 'arbitrary'
  readonly [generatedType]: T
}
export type Generated<S> = S extends Arbitrary<infer T> ? T : never
export type GeneratedTuple<S extends readonly Arbitrary[]> = { -readonly [K in keyof S]: Generated<S[K]> }
export type GeneratedRecord<S extends Readonly<Record<string, Arbitrary>>> = {
  -readonly [K in keyof S]: Generated<S[K]>
}

export type Generation =
  | { readonly kind: 'integer'; readonly min: number; readonly max: number }
  | { readonly kind: 'string'; readonly min: number; readonly max: number }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'constant'; readonly value: Value }
  | { readonly kind: 'array'; readonly item: Generation; readonly min: number; readonly max: number }
  | { readonly kind: 'tuple'; readonly items: readonly Generation[] }
  | { readonly kind: 'record'; readonly fields: readonly { readonly key: string; readonly source: Generation }[] }
  | { readonly kind: 'choice'; readonly items: readonly [Generation, ...Generation[]] }

class Generator<T> implements Arbitrary<T> {
  readonly kind = 'arbitrary'
  declare readonly [generatedType]: T
  readonly #source: Generation
  constructor(source: Generation) {
    this.#source = Object.freeze(source)
    Object.freeze(this)
  }
  static source(value: Value): Generation {
    if (!(value instanceof Generator)) throw new TypeError('input generation requires an arbitrary constructor')
    return value.#source
  }
}
export const generationOf = Generator.source

function bounds(min: number, max: number, length = false) {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max || (length && min < 0))
    throw new TypeError('invalid generation range')
  return { min, max }
}
export function integers(options: { min?: number; max?: number } = {}): Arbitrary<number> {
  return new Generator({
    kind: 'integer',
    ...bounds(options.min ?? Number.MIN_SAFE_INTEGER, options.max ?? Number.MAX_SAFE_INTEGER),
  })
}
export function strings(options: { minLength?: number; maxLength?: number } = {}): Arbitrary<string> {
  return new Generator({ kind: 'string', ...bounds(options.minLength ?? 0, options.maxLength ?? 100, true) })
}
export function boolean(): Arbitrary<boolean> {
  return new Generator({ kind: 'boolean' })
}
export function constant<const T extends Value>(value: T): Arbitrary<T> {
  return new Generator({ kind: 'constant', value: copyData(value) })
}
export function arrays<T>(
  source: Arbitrary<T>,
  options: { minLength?: number; maxLength?: number } = {},
): Arbitrary<T[]> {
  return new Generator({
    kind: 'array',
    item: generationOf(source),
    ...bounds(options.minLength ?? 0, options.maxLength ?? 100, true),
  })
}
export function tuples<const S extends readonly Arbitrary[]>(...sources: S): Arbitrary<GeneratedTuple<S>> {
  return new Generator({ kind: 'tuple', items: Object.freeze(sources.map(generationOf)) })
}
export function record<const S extends Readonly<Record<string, Arbitrary>>>(sources: S): Arbitrary<GeneratedRecord<S>> {
  const fields = Reflect.ownKeys(sources).map((key) => {
    if (typeof key !== 'string') throw new TypeError('record generator keys must be strings')
    const descriptor = Object.getOwnPropertyDescriptor(sources, key)
    if (!descriptor || !('value' in descriptor)) throw new TypeError('record generator fields must be data properties')
    return Object.freeze({ key, source: generationOf(property(sources, key)) })
  })
  return new Generator({ kind: 'record', fields: Object.freeze(fields) })
}
export function oneOf<const S extends readonly [Arbitrary, ...Arbitrary[]]>(
  ...sources: S
): Arbitrary<Generated<S[number]>> {
  const [first, ...rest] = sources
  if (!first) throw new TypeError('oneOf requires at least one source')
  return new Generator({ kind: 'choice', items: Object.freeze([generationOf(first), ...rest.map(generationOf)]) })
}

export function fixedGeneration(source: Generation): boolean {
  switch (source.kind) {
    case 'constant':
      return true
    case 'tuple':
      return source.items.every(fixedGeneration)
    case 'record':
      return source.fields.every((field) => fixedGeneration(field.source))
    default:
      return false
  }
}

export const generationVersion = 1
export interface RandomState {
  readonly word: number
}
export function seeded(seed: number): RandomState {
  if (!Number.isSafeInteger(seed)) throw new TypeError('seed must be a safe integer')
  return { word: Number(BigInt.asUintN(32, BigInt(seed) ^ (BigInt(seed) >> 32n))) }
}
function randomWord(state: RandomState): { state: RandomState; value: number } {
  const word = (Math.imul(state.word, 1664525) + 1013904223) >>> 0
  let value = word ^ (word >>> 16)
  value = Math.imul(value, 0x7feb352d)
  value ^= value >>> 15
  value = Math.imul(value, 0x846ca68b)
  return { state: { word }, value: (value ^ (value >>> 16)) >>> 0 }
}
function randomInteger(state: RandomState, min: number, max: number) {
  const high = randomWord(state),
    low = randomWord(high.state)
  const bits = (BigInt(high.value) << 32n) | BigInt(low.value)
  const value = Number(BigInt(min) + (bits % (BigInt(max) - BigInt(min) + 1n)))
  return { state: low.state, value }
}
export function generate(
  source: Generation,
  state: RandomState,
): { readonly state: RandomState; readonly value: Value } {
  switch (source.kind) {
    case 'constant':
      return { state, value: copyData(source.value) }
    case 'integer':
      return randomInteger(state, source.min, source.max)
    case 'boolean': {
      const draw = randomWord(state)
      return { state: draw.state, value: (draw.value & 1) === 0 }
    }
    case 'choice': {
      const draw = randomInteger(state, 0, source.items.length - 1)
      return generate(required(source.items[draw.value]), draw.state)
    }
    case 'tuple': {
      const values: Value[] = []
      for (const item of source.items) {
        const next = generate(item, state)
        state = next.state
        values.push(next.value)
      }
      return { state, value: values }
    }
    case 'record': {
      const values: [string, Value][] = []
      for (const field of source.fields) {
        const next = generate(field.source, state)
        state = next.state
        values.push([field.key, next.value])
      }
      return { state, value: Object.fromEntries(values) }
    }
    case 'array': {
      const size = randomInteger(state, source.min, source.max)
      state = size.state
      const values: Value[] = []
      for (let index = 0; index < size.value; index++) {
        const next = generate(source.item, state)
        state = next.state
        values.push(next.value)
      }
      return { state, value: values }
    }
    case 'string': {
      const size = randomInteger(state, source.min, source.max)
      state = size.state
      const values: string[] = []
      for (let index = 0; index < size.value; index++) {
        const next = randomInteger(state, 0, 0x10f7ff)
        state = next.state
        values.push(String.fromCodePoint(next.value >= 0xd800 ? next.value + 0x800 : next.value))
      }
      return { state, value: values.join('') }
    }
  }
}

function* smallerIntegers(value: number, min: number, max: number): Iterable<number> {
  const target = BigInt(Math.max(min, Math.min(0, max)))
  const original = BigInt(value)
  if (target === original) return
  yield Number(target)
  let distance = (original - target) / 2n
  while (distance !== 0n) {
    yield Number(original - distance)
    distance /= 2n
  }
}
function* shorter<T>(items: readonly T[], min: number): Iterable<T[]> {
  for (let count = items.length - min; count > 0; count = Math.floor(count / 2)) {
    for (let at = 0; at + count <= items.length; at += count) yield [...items.slice(0, at), ...items.slice(at + count)]
  }
}

/** Shrinking is finite and stays inside the source's declared domain. */
export function* shrink(source: Generation, value: Value): Iterable<Value> {
  switch (source.kind) {
    case 'constant':
      return
    case 'integer':
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < source.min || value > source.max)
        throw new TypeError('integer sample is outside its source')
      yield* smallerIntegers(value, source.min, source.max)
      return
    case 'boolean':
      if (typeof value !== 'boolean') throw new TypeError('boolean sample is invalid')
      if (value) yield false
      return
    case 'string': {
      if (typeof value !== 'string') throw new TypeError('string sample is invalid')
      const characters = Array.from(value)
      if (characters.length < source.min || characters.length > source.max)
        throw new TypeError('string sample is outside its source')
      for (const candidate of shorter(characters, source.min)) yield candidate.join('')
      for (const [index, character] of characters.entries()) {
        if (character === '\0') continue
        yield [...characters.slice(0, index), '\0', ...characters.slice(index + 1)].join('')
      }
      return
    }
    case 'array': {
      const items = arrayValue(value)
      if (items.length < source.min || items.length > source.max)
        throw new TypeError('array sample is outside its source')
      yield* shorter(items, source.min)
      for (const [index, item] of items.entries())
        for (const candidate of shrink(source.item, item))
          yield [...items.slice(0, index), candidate, ...items.slice(index + 1)]
      return
    }
    case 'tuple': {
      const items = arrayValue(value)
      if (items.length !== source.items.length) throw new TypeError('tuple sample has wrong length')
      for (const [index, item] of source.items.entries())
        for (const candidate of shrink(item, items[index]))
          yield [...items.slice(0, index), candidate, ...items.slice(index + 1)]
      return
    }
    case 'record': {
      for (const field of source.fields) {
        for (const candidate of shrink(field.source, property(value, field.key)))
          yield Object.fromEntries(
            source.fields.map((item) => [item.key, item === field ? candidate : property(value, item.key)]),
          )
      }
      return
    }
    case 'choice':
      // Candidate generation, rather than narrowing the sample, also handles overlapping sources.
      for (const [index, item] of source.items.entries()) yield generate(item, seeded(index)).value
      return
  }
}
