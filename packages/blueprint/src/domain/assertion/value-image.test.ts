import { expect, test } from 'vite-plus/test'
import { captureValue, equalValues } from './value-image.js'
import type { Value } from '../definition/javascript.js'

const same = (left: Value, right: Value) => equalValues(captureValue(left), captureValue(right))

test('saved expectations and actual values do not follow later mutation', () => {
  const input = { name: 'Alice', bytes: new Uint8Array([65]), map: new Map([['x', 1]]) }
  const expected = captureValue(input)
  input.name = 'Wrong'
  input.bytes[0] = 66
  input.map.set('x', 2)
  expect(equalValues(expected, captureValue(input))).toBe(false)
  expect(
    equalValues(expected, captureValue({ name: 'Alice', bytes: new Uint8Array([65]), map: new Map([['x', 1]]) })),
  ).toBe(true)
})

test('compares standard native values by type and contents', () => {
  expect(same(new Uint8Array([65]), new Uint8Array([65]))).toBe(true)
  expect(same(new Uint8Array([65]), new Uint8ClampedArray([65]))).toBe(false)
  expect(same(new Float64Array([NaN, -0]), new Float64Array([NaN, -0]))).toBe(true)
  expect(same(new Float64Array([-0]), new Float64Array([0]))).toBe(false)
  expect(same(new Date(5), new Date(6))).toBe(false)
  expect(same(new Date(NaN), new Date(NaN))).toBe(true)
  expect(same(/hello/gi, /hello/gi)).toBe(true)
  expect(same(/hello/g, /bye/g)).toBe(false)
  expect(same(new Uint8Array([9, 1, 2]).subarray(1), new Uint8Array([1, 2]))).toBe(true)
})

test('unordered maps and sets match entries once and support cycles', () => {
  expect(
    same(
      new Map([
        [{ id: 1 }, 'a'],
        [{ id: 2 }, 'b'],
      ]),
      new Map([
        [{ id: 2 }, 'b'],
        [{ id: 1 }, 'a'],
      ]),
    ),
  ).toBe(true)
  expect(same(new Set([{ id: 1 }, { id: 1 }]), new Set([{ id: 1 }, { id: 2 }]))).toBe(false)
  const left = new Map<Value, Value>()
  left.set('self', left)
  left.set('value', 1)
  const right = new Map<Value, Value>()
  right.set('value', 1)
  right.set('self', right)
  expect(same(left, right)).toBe(true)
  right.set('value', 2)
  expect(same(left, right)).toBe(false)
})

test('distinguishes missing fields, sparse arrays, prototypes, and identity values', () => {
  expect(same({}, { field: undefined })).toBe(false)
  const sparse: Value[] = []
  sparse.length = 1
  expect(same(sparse, [undefined])).toBe(false)
  class ValueObject {
    amount = 5
  }
  expect(same(new ValueObject(), new ValueObject())).toBe(true)
  expect(same(new ValueObject(), { amount: 5 })).toBe(false)
  const fn = () => 1
  expect(same(fn, fn)).toBe(true)
  expect(same(fn, () => 1)).toBe(false)
  expect(same(Symbol('x'), Symbol('x'))).toBe(false)
})

test('does not evaluate getters or compare Error stacks', () => {
  let calls = 0
  const read = () => {
    calls++
    return 1
  }
  const left = Object.defineProperty({}, 'amount', { get: read })
  const right = Object.defineProperty({}, 'amount', { get: read })
  expect(same(left, right)).toBe(true)
  expect(calls).toBe(0)
  class Denied extends Error {
    code = 'denied'
  }
  const a = new Denied('no'),
    b = new Denied('no')
  a.stack = 'first'
  b.stack = 'second'
  expect(same(a, b)).toBe(true)
  b.code = 'other'
  expect(same(a, b)).toBe(false)
  class Secret {
    #value = 1
    value() {
      return this.#value
    }
  }
  expect(() => captureValue(new Secret())).toThrow('opaque-value')
})

test('DataView comparison reads native bytes without invoking shadowed accessors', () => {
  let reads = 0
  const getter = () => {
    reads++
    throw new Error('must not run')
  }
  const left = new DataView(new Uint8Array([1, 2]).buffer)
  const right = new DataView(new Uint8Array([1, 2]).buffer)
  for (const value of [left, right]) Object.defineProperty(value, 'buffer', { get: getter })
  expect(equalValues(captureValue(left), captureValue(right))).toBe(true)
  expect(reads).toBe(0)
})
