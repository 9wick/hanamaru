import type { AnyFn } from '@hanamaru/blueprint/model'
import type { Value } from './javascript.js'
import { fieldsValue, functionValue, objectValue, valueOf } from './javascript.js'
import type { Fields } from '@hanamaru/blueprint/model'

export function plainFields(value: Value): Fields {
  if (value === undefined) return {}
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].some((prototype) => Object.is(prototype, Object.getPrototypeOf(value)))
  ) {
    throw new TypeError('next(fields) requires a plain object')
  }
  return fieldsValue(value)
}

export function methodValue<T>(object: T, key: PropertyKey): AnyFn {
  if (object === null || (typeof object !== 'object' && typeof object !== 'function'))
    throw new TypeError('method target must be an object')
  let current: object | null = object
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key)
    if (descriptor) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function')
        throw new TypeError('method target must be a data property containing a function')
      return functionValue(descriptor.value)
    }
    const prototype: Value = valueOf(Object.getPrototypeOf(current))
    current = prototype === null ? null : objectValue(prototype)
  }
  throw new TypeError('method target does not exist')
}
