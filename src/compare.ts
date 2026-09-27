import { valueOf, required } from './value.js'

const enumerableKeys = (value: object) =>
  Reflect.ownKeys(value).filter((key) => Object.getOwnPropertyDescriptor(value, key)?.enumerable)

export function equal<T, U>(first: T, second: U, seen = new WeakMap<object, WeakSet<object>>()): boolean {
  const a = valueOf(first),
    b = valueOf(second)
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false
  let pairs = seen.get(a)
  if (pairs?.has(b)) return true
  if (!pairs) {
    pairs = new WeakSet()
    seen.set(a, pairs)
  }
  pairs.add(b)
  try {
    if (a instanceof Date && b instanceof Date) return Object.is(a.getTime(), b.getTime())
    if (a instanceof RegExp && b instanceof RegExp) return a.source === b.source && a.flags === b.flags
    if (a instanceof WeakMap || a instanceof WeakSet || a instanceof Promise) return false
    if (a instanceof Map && b instanceof Map) {
      if (a.size !== b.size) return false
      const unmatched = [...b.entries()]
      for (const [key, value] of a) {
        const index = unmatched.findIndex(
          ([otherKey, otherValue]) =>
            equal(valueOf(key), valueOf(otherKey), seen) && equal(valueOf(value), valueOf(otherValue), seen),
        )
        if (index < 0) return false
        unmatched.splice(index, 1)
      }
      return true
    }
    if (a instanceof Set && b instanceof Set) {
      if (a.size !== b.size) return false
      const unmatched = [...b.values()]
      for (const value of a) {
        const index = unmatched.findIndex((other) => equal(valueOf(value), valueOf(other), seen))
        if (index < 0) return false
        unmatched.splice(index, 1)
      }
      return true
    }
    if (
      a instanceof Error &&
      b instanceof Error &&
      (a.name !== b.name || a.message !== b.message || !equal(a.cause, b.cause, seen))
    )
      return false
    if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return false
    const keysA = enumerableKeys(a).filter(
      (key) => !(a instanceof Error && ['name', 'message', 'stack', 'cause'].includes(String(key))),
    )
    const keysB = enumerableKeys(b).filter(
      (key) => !(a instanceof Error && ['name', 'message', 'stack', 'cause'].includes(String(key))),
    )
    if (keysA.length !== keysB.length) return false
    for (const key of keysA) {
      if (!keysB.includes(String(key))) return false
      const descriptorA = required(Object.getOwnPropertyDescriptor(a, key))
      const descriptorB = required(Object.getOwnPropertyDescriptor(b, key))
      if ('value' in descriptorA !== 'value' in descriptorB) return false
      if (
        'value' in descriptorA
          ? !equal(valueOf(descriptorA.value), valueOf(descriptorB.value), seen)
          : !Object.is(descriptorA.get, descriptorB.get) || !Object.is(descriptorA.set, descriptorB.set)
      )
        return false
    }
    return true
  } finally {
    pairs.delete(b)
  }
}

export function matchObject<T, U>(first: T, second: U, seen = new WeakMap<object, WeakSet<object>>()): boolean {
  const actual = valueOf(first),
    expected = valueOf(second)
  if (typeof expected !== 'object' || !expected || typeof actual !== 'object' || !actual) return equal(actual, expected)
  let pairs = seen.get(expected)
  if (pairs?.has(actual)) return true
  if (!pairs) {
    pairs = new WeakSet()
    seen.set(expected, pairs)
  }
  pairs.add(actual)
  try {
    for (const key of enumerableKeys(expected)) {
      if (!Object.prototype.hasOwnProperty.call(actual, key)) return false
      const expectedDescriptor = required(Object.getOwnPropertyDescriptor(expected, key))
      const actualDescriptor = required(Object.getOwnPropertyDescriptor(actual, key))
      if ('value' in expectedDescriptor !== 'value' in actualDescriptor) return false
      if (
        'value' in expectedDescriptor
          ? !matchObject(valueOf(actualDescriptor.value), valueOf(expectedDescriptor.value), seen)
          : !Object.is(expectedDescriptor.get, actualDescriptor.get) ||
            !Object.is(expectedDescriptor.set, actualDescriptor.set)
      )
        return false
    }
    return true
  } finally {
    pairs.delete(actual)
  }
}
