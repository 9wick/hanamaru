import type { Value } from './javascript.js'
import { objectValue, valueOf } from './javascript.js'

const typedArrays = [
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
]

const typedArrayPrototype = objectValue(valueOf(Object.getPrototypeOf(Uint8Array.prototype)))
function nativeProperty(prototype: object, key: string, receiver: object): Value {
  const getter = Object.getOwnPropertyDescriptor(prototype, key)?.get
  if (typeof getter !== 'function') throw new TypeError('native data getter is unavailable')
  return valueOf(Reflect.apply(getter, receiver, []))
}

/** 述語へ渡すデータをコピーする。独自クラスを元の型のまま複製したとは扱わない。 */
export function copyData(input: Value): Value {
  const copies = new Map<object, object>()
  function copy(value: Value): Value {
    if (typeof value === 'function') throw new TypeError('data cannot contain functions; project the value first')
    if (typeof value !== 'object' || value === null) return value
    const previous = copies.get(value)
    if (previous !== undefined) return previous
    const rawPrototype = valueOf(Object.getPrototypeOf(value))
    const prototype = rawPrototype === null ? null : objectValue(rawPrototype)
    let output: object
    if (Array.isArray(value) && prototype === Array.prototype) output = []
    else if (prototype === Object.prototype || prototype === null)
      output = objectValue(valueOf(Object.create(prototype)))
    else if (value instanceof Date && prototype === Date.prototype)
      output = new Date(Date.prototype.getTime.call(value))
    else if (value instanceof Map && prototype === Map.prototype) {
      const result = new Map<Value, Value>()
      copies.set(value, result)
      const entries: Iterable<readonly [unknown, unknown]> = Map.prototype.entries.call(value)
      for (const [key, item] of entries) result.set(copy(valueOf(key)), copy(valueOf(item)))
      output = result
    } else if (value instanceof Set && prototype === Set.prototype) {
      const result = new Set<Value>()
      copies.set(value, result)
      const entries: Iterable<unknown> = Set.prototype.values.call(value)
      for (const item of entries) result.add(copy(valueOf(item)))
      output = result
    } else if (value instanceof ArrayBuffer && prototype === ArrayBuffer.prototype) {
      const bytes = new Uint8Array(value)
      const buffer = new ArrayBuffer(bytes.length)
      new Uint8Array(buffer).set(bytes)
      output = buffer
    } else if (ArrayBuffer.isView(value)) {
      const constructor = typedArrays.find((item) => prototype === item.prototype)
      if (prototype !== DataView.prototype && constructor === undefined)
        throw new TypeError('custom view prototypes require a projection')
      const native = prototype === DataView.prototype ? DataView.prototype : typedArrayPrototype
      const buffer = copy(nativeProperty(native, 'buffer', value))
      const byteOffset = nativeProperty(native, 'byteOffset', value)
      const byteLength = nativeProperty(native, 'byteLength', value)
      if (typeof byteOffset !== 'number' || typeof byteLength !== 'number')
        throw new TypeError('invalid native view range')
      if (!(buffer instanceof ArrayBuffer)) throw new TypeError('data views require an ArrayBuffer')
      const nested = copies.get(value)
      if (nested !== undefined) return nested
      output =
        constructor === undefined
          ? new DataView(buffer, byteOffset, byteLength)
          : new constructor(buffer, byteOffset, byteLength / constructor.BYTES_PER_ELEMENT)
    } else throw new TypeError('custom prototypes require a data projection')
    copies.set(value, output)
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined) throw new TypeError('data property disappeared while copying')
      if (!('value' in descriptor)) throw new TypeError('data cannot contain accessors; project the value first')
      Object.defineProperty(output, key, { ...descriptor, value: copy(valueOf(descriptor.value)) })
    }
    return output
  }
  return copy(input)
}
