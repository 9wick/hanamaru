import { expect, expectTypeOf, test } from 'vite-plus/test'
import {
  arrays,
  boolean,
  constant,
  fixedGeneration,
  generate,
  generationOf,
  integers,
  oneOf,
  record,
  seeded,
  shrink,
  strings,
  tuples,
} from './generation.js'
import type { Arbitrary } from './generation.js'
import { arrayValue } from './javascript.js'
import type { Value } from './javascript.js'

function sample(source: Arbitrary, seed: number, count: number): Value[] {
  let state = seeded(seed)
  const values: Value[] = []
  for (let index = 0; index < count; index++) {
    const next = generate(generationOf(source), state)
    state = next.state
    values.push(next.value)
  }
  return values
}

test('constructors infer tuples, records, and choice unions without redeclaring types', () => {
  expectTypeOf(tuples(integers(), strings(), boolean())).toEqualTypeOf<Arbitrary<[number, string, boolean]>>()
  expectTypeOf(record({ age: integers(), name: strings() })).toEqualTypeOf<Arbitrary<{ age: number; name: string }>>()
  expectTypeOf(oneOf(constant('a'), constant(1))).toEqualTypeOf<Arbitrary<'a' | 1>>()
})

test('sampling is reproducible, covers both binary choices, and respects full safe-integer bounds', () => {
  const source = tuples(integers(), integers({ min: 0, max: 1 }), oneOf(constant('a'), constant('b')))
  const values = sample(source, Number.MAX_SAFE_INTEGER, 200)
  expect(values).toEqual(sample(source, Number.MAX_SAFE_INTEGER, 200))
  expect(values).not.toEqual(sample(source, 1, 200))
  const choices = new Set<Value>()
  const bits = new Set<Value>()
  for (const value of values) {
    if (!Array.isArray(value)) throw new Error('tuple sample must be an array')
    expect(Number.isSafeInteger(value[0])).toBe(true)
    const items = arrayValue(value)
    bits.add(items[1])
    choices.add(items[2])
  }
  expect(bits).toEqual(new Set([0, 1]))
  expect(choices).toEqual(new Set(['a', 'b']))
})

test('constant snapshots are isolated at definition and each evaluation', () => {
  const original = { list: [1] }
  const source = constant(original)
  original.list.push(2)
  const first = generate(generationOf(source), seeded(4)).value
  expect(first).toEqual({ list: [1] })
  if (typeof first !== 'object' || first === null || !('list' in first) || !Array.isArray(first.list))
    throw new Error('invalid sample')
  first.list.push(3)
  expect(generate(generationOf(source), seeded(4)).value).toEqual({ list: [1] })
  expect(fixedGeneration(generationOf(tuples(record({ value: source }))))).toBe(true)
  expect(fixedGeneration(generationOf(tuples()))).toBe(true)
  expect(fixedGeneration(generationOf(integers({ min: 1, max: 1 })))).toBe(false)
})

test('integer shrinking finds a small counterexample and never leaves a bounded domain', () => {
  const source = generationOf(integers({ min: -200, max: 200 }))
  let counterexample = 100
  for (let budget = 0; budget < 100; budget++) {
    const candidate = [...shrink(source, counterexample)].find((value) => typeof value === 'number' && value >= 10)
    if (typeof candidate !== 'number') break
    expect(candidate).toBeLessThan(counterexample)
    counterexample = candidate
  }
  expect(counterexample).toBe(10)
  expect(
    [...shrink(generationOf(integers({ min: 50, max: 100 })), 100)].every(
      (value) => typeof value === 'number' && value >= 50 && value < 100,
    ),
  ).toBe(true)
})

test('string and array shrinking preserve minimum lengths and Unicode scalar values', () => {
  const source = strings({ minLength: 2, maxLength: 5 })
  for (const value of sample(source, 3, 30)) {
    if (typeof value !== 'string') throw new Error('invalid string sample')
    for (const candidate of [value, ...shrink(generationOf(source), value)]) {
      if (typeof candidate !== 'string') throw new Error('invalid string shrink')
      expect(Array.from(candidate).length).toBeGreaterThanOrEqual(2)
      expect(Array.from(candidate).length).toBeLessThanOrEqual(5)
      expect(
        Array.from(candidate).every((character) => {
          const point = character.codePointAt(0)
          return point !== undefined && (point < 0xd800 || point > 0xdfff)
        }),
      ).toBe(true)
    }
  }
  const list = arrays(integers({ min: 3, max: 5 }), { minLength: 2, maxLength: 4 })
  for (const candidate of shrink(generationOf(list), [5, 4, 3, 5])) {
    if (!Array.isArray(candidate)) throw new Error('invalid array sample')
    expect(candidate.length).toBeGreaterThanOrEqual(2)
    expect(candidate.every((value) => typeof value === 'number' && value >= 3 && value <= 5)).toBe(true)
  }
})

test('invalid sources and ranges fail at definition rather than producing no cases', () => {
  expect(() => integers({ min: 2, max: 1 })).toThrow('range')
  expect(() => integers({ max: Infinity })).toThrow('range')
  expect(() => strings({ minLength: -1 })).toThrow('range')
  expect(() => arrays(boolean(), { maxLength: 0.5 })).toThrow('range')
  expect(() => seeded(NaN)).toThrow('seed')
  expect(() => generationOf({ kind: 'arbitrary' })).toThrow('constructor')
  expect(() =>
    constant({
      get value() {
        throw new Error('must not read')
      },
    }),
  ).toThrow('accessors')
})
