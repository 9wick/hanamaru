import { expect, test } from 'vite-plus/test'
import { copyData } from './data-copy.js'

test('copies cyclic data and preserves aliases without retaining mutable source state', () => {
  const child = { value: 1 }
  const source: { left: typeof child; right: typeof child; self?: object } = { left: child, right: child }
  source.self = source
  const copied = copyData(source)
  child.value = 2
  expect(copied).toEqual({ left: { value: 1 }, right: { value: 1 }, self: copied })
  expect(copied).not.toBe(source)
  if (typeof copied !== 'object' || copied === null || !('left' in copied) || !('right' in copied))
    throw new Error('copy must have the original fields')
  expect(copied.left).toBe(copied.right)
})

test('copies native collections and shared typed-array buffers', () => {
  const buffer = new ArrayBuffer(8)
  const bytes = new Uint8Array(buffer)
  bytes[0] = 42
  const source = {
    buffer,
    bytes,
    view: new DataView(buffer),
    date: new Date(123),
    map: new Map([['a', bytes]]),
    set: new Set([bytes]),
  }
  const copied = copyData(source)
  expect(copied).toEqual(source)
  bytes[0] = 9
  if (typeof copied !== 'object' || copied === null || !('bytes' in copied) || !(copied.bytes instanceof Uint8Array))
    throw new Error('copy must retain the native array type')
  expect(copied.bytes[0]).toBe(42)
  if (!('buffer' in copied) || !('view' in copied) || !(copied.view instanceof DataView))
    throw new Error('missing views')
  expect(copied.bytes.buffer).toBe(copied.buffer)
  expect(copied.view.buffer).toBe(copied.buffer)
})

test('rejects private class instances and accessors instead of changing their meaning', () => {
  class Money {
    #amount = 10
    amount() {
      return this.#amount
    }
  }
  let reads = 0
  expect(() => copyData(new Money())).toThrow('projection')
  expect(() =>
    copyData({
      get value() {
        reads++
        return 1
      },
    }),
  ).toThrow('accessors')
  expect(() => copyData({ fn: () => 1 })).toThrow('functions')
  expect(reads).toBe(0)
})

test('native data copying never invokes overridden accessors or iteration hooks', () => {
  let reads = 0
  const getter = () => {
    reads++
    throw new Error('must not be called')
  }
  const values: readonly (readonly [object, PropertyKey])[] = [
    [new Date(0), 'getTime'],
    [new Map([[1, 2]]), Symbol.iterator],
    [new Set([1]), Symbol.iterator],
    [new ArrayBuffer(4), 'constructor'],
    [new Uint8Array([1]), 'buffer'],
    [new DataView(new ArrayBuffer(4)), 'byteOffset'],
  ]
  for (const [value, key] of values) {
    Object.defineProperty(value, key, { get: getter })
    expect(() => copyData(value)).toThrow('accessors')
  }
  expect(reads).toBe(0)
})
