import { function as functionSchema, parse } from 'valibot'

/** moduleの評価・transport・export操作で扱うJavaScriptの値。 */
export type Value = undefined | null | boolean | number | bigint | string | symbol | object

export function valueOf(input: unknown): Value {
  if (input === null) return null
  if (input === undefined) return undefined
  if (
    typeof input === 'boolean' ||
    typeof input === 'number' ||
    typeof input === 'bigint' ||
    typeof input === 'string' ||
    typeof input === 'symbol' ||
    typeof input === 'object' ||
    typeof input === 'function'
  )
    return input
  throw new TypeError('unsupported JavaScript value')
}

export function property<T>(input: T, key: PropertyKey): Value {
  if ((typeof input !== 'object' || input === null) && typeof input !== 'function')
    throw new TypeError('property target must be an object')
  return valueOf(Reflect.get(input, key))
}

export function invoke(fn: object, receiver: Value, args: readonly Value[]): Value {
  if (typeof fn !== 'function') throw new TypeError('callback must be a function')
  return valueOf(Reflect.apply(fn, receiver, args))
}

export function objectValue(value: Value): object {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function')
    throw new TypeError('value must be an object')
  return value
}

export function arrayValue<T>(input: T): Value[] {
  if (!Array.isArray(input)) throw new TypeError('value must be an array')
  return input.map(valueOf)
}

export function fieldsValue<T>(input: T): Record<PropertyKey, Value> {
  const value = objectValue(valueOf(input))
  return Object.fromEntries(Reflect.ownKeys(value).map((key) => [key, property(value, key)]))
}

export function functionValue<T>(input: T) {
  return parse(functionSchema(), input)
}

export function required<T>(input: T | null | undefined, message = 'required value is missing'): NonNullable<T> {
  if (input === null || input === undefined) throw new TypeError(message)
  return input
}
