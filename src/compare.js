const enumerableKeys = (value) =>
  Reflect.ownKeys(value).filter((key) => Object.getOwnPropertyDescriptor(value, key)?.enumerable)

export function equal(a, b, seen = new WeakMap()) {
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
    if (a instanceof Date) return Object.is(a.getTime(), b.getTime())
    if (a instanceof RegExp) return a.source === b.source && a.flags === b.flags
    if (a instanceof WeakMap || a instanceof WeakSet || a instanceof Promise) return false
    if (a instanceof Map) {
      if (a.size !== b.size) return false
      const unmatched = [...b.entries()]
      for (const [key, value] of a) {
        const index = unmatched.findIndex(
          ([otherKey, otherValue]) => equal(key, otherKey, seen) && equal(value, otherValue, seen),
        )
        if (index < 0) return false
        unmatched.splice(index, 1)
      }
      return true
    }
    if (a instanceof Set) {
      if (a.size !== b.size) return false
      const unmatched = [...b.values()]
      for (const value of a) {
        const index = unmatched.findIndex((other) => equal(value, other, seen))
        if (index < 0) return false
        unmatched.splice(index, 1)
      }
      return true
    }
    if (a instanceof Error && (a.name !== b.name || a.message !== b.message || !equal(a.cause, b.cause, seen)))
      return false
    if (Array.isArray(a) && a.length !== b.length) return false
    const keysA = enumerableKeys(a).filter(
      (key) => !(a instanceof Error && ['name', 'message', 'stack', 'cause'].includes(key)),
    )
    const keysB = enumerableKeys(b).filter(
      (key) => !(a instanceof Error && ['name', 'message', 'stack', 'cause'].includes(key)),
    )
    if (keysA.length !== keysB.length) return false
    for (const key of keysA) {
      if (!keysB.includes(key)) return false
      const descriptorA = Object.getOwnPropertyDescriptor(a, key)
      const descriptorB = Object.getOwnPropertyDescriptor(b, key)
      if ('value' in descriptorA !== 'value' in descriptorB) return false
      if (
        'value' in descriptorA
          ? !equal(descriptorA.value, descriptorB.value, seen)
          : !Object.is(descriptorA.get, descriptorB.get) || !Object.is(descriptorA.set, descriptorB.set)
      )
        return false
    }
    return true
  } finally {
    pairs.delete(b)
  }
}

export function matchObject(actual, expected, seen = new WeakMap()) {
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
      const expectedDescriptor = Object.getOwnPropertyDescriptor(expected, key)
      const actualDescriptor = Object.getOwnPropertyDescriptor(actual, key)
      if ('value' in expectedDescriptor !== 'value' in actualDescriptor) return false
      if (
        'value' in expectedDescriptor
          ? !matchObject(actualDescriptor.value, expectedDescriptor.value, seen)
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
