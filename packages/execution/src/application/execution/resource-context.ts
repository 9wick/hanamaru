import type { JsonValue, Fields } from '@hanamaru/blueprint/model'
import type { Value } from '../../domain/execution/javascript.js'
import { property, valueOf } from '../../domain/execution/javascript.js'

function cloneJson(value: Value, path: string, ancestors: Set<object>): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return value
  if (typeof value !== 'object' || value === null) throw new TypeError(`resource data at ${path} must be JSON data`)
  if (ancestors.has(value)) throw new TypeError(`resource data at ${path} is cyclic`)
  const prototype = valueOf(Object.getPrototypeOf(value))
  if (
    Array.isArray(value)
      ? !Object.is(prototype, Array.prototype)
      : ![Object.prototype, null].some((p) => Object.is(p, prototype))
  )
    throw new TypeError(`resource data at ${path} must have a plain prototype`)
  ancestors.add(value)
  try {
    const keys = Reflect.ownKeys(value)
    if (Array.isArray(value)) {
      if (keys.length !== value.length + 1)
        throw new TypeError(`resource array at ${path} must be dense without extra properties`)
      const items: JsonValue[] = []
      for (let i = 0; i < value.length; i++)
        items.push(cloneJson(dataProperty(value, String(i), path), `${path}[${i}]`, ancestors))
      return items
    }
    return Object.fromEntries(
      keys.map((key) => {
        if (typeof key !== 'string') throw new TypeError(`resource data at ${path} cannot have symbol keys`)
        return [key, cloneJson(dataProperty(value, key, path), `${path}.${key}`, ancestors)]
      }),
    )
  } finally {
    ancestors.delete(value)
  }
}

function dataProperty(value: object, key: string, path: string): Value {
  const d = Object.getOwnPropertyDescriptor(value, key)
  if (!d || !d.enumerable || !('value' in d))
    throw new TypeError(`resource data at ${path}.${key} must be an enumerable data property`)
  return property(value, key)
}

export function jsonFields(value: Value = {}): Fields {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('resource next(fields) requires a plain object')
  const cloned = cloneJson(value, '$', new Set())
  if (cloned === null || typeof cloned !== 'object' || Array.isArray(cloned))
    throw new TypeError('resource fields must be an object')
  return Object.fromEntries(Object.keys(cloned).map((key) => [key, property(cloned, key)]))
}

export function freezeFields(fields: Fields): Readonly<Fields> {
  const freeze = (value: Value): void => {
    if (value === null || typeof value !== 'object') return
    for (const key of Object.keys(value)) freeze(property(value, key))
    Object.freeze(value)
  }
  freeze(fields)
  return fields
}

export function mergeResourceFields(inputs: readonly Fields[]): Fields {
  const result: Fields = {}
  for (const fields of inputs)
    for (const [key, value] of Object.entries(fields)) {
      if (Object.hasOwn(result, key)) throw new TypeError(`resource context key collision: ${key}`)
      Object.defineProperty(result, key, { value, writable: true, enumerable: true, configurable: true })
    }
  return result
}
