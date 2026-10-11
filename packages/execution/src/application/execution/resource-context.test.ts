import { expect, test } from 'vite-plus/test'
import type { Value } from '../../domain/execution/javascript.js'
import { jsonFields } from './resource-context.js'

test.each<Value>([undefined, NaN, Infinity, -0, 1n, Symbol('x'), () => 1, new Date(), new Map(), new Set()])(
  'rejects non-JSON field values: %s',
  (value) => {
    expect(() => jsonFields({ value })).toThrow('resource data')
  },
)

test('rejects cyclic, sparse and silently dropped properties without invoking getters', () => {
  const customArray = [1, 2]
  Object.setPrototypeOf(customArray, { tag: 'custom' })
  const sparse = [1, 2]
  delete sparse[1]
  const cyclic: { self?: object } = {}
  cyclic.self = cyclic
  for (const value of [
    cyclic,
    sparse,
    customArray,
    { [Symbol('x')]: 1 },
    Object.defineProperty({}, 'hidden', { value: 1 }),
  ])
    expect(() => jsonFields({ value })).toThrow('resource')
  let calls = 0
  expect(() =>
    jsonFields({
      get x() {
        calls++
        return 1
      },
    }),
  ).toThrow('enumerable data property')
  expect(calls).toBe(0)
})

test('copies valid JSON data, preserving own __proto__ keys and allowing shared references', () => {
  const shared = { value: 2 }
  const input = { a: shared, b: shared, array: [null, true, 'x', 1], ['__proto__']: { value: 3 } }
  const output = jsonFields(input)
  expect(output).toEqual(input)
  expect(output.a).not.toBe(shared)
  expect(output.a).not.toBe(output.b)
  expect(Object.getPrototypeOf(output)).toBe(Object.prototype)
})
