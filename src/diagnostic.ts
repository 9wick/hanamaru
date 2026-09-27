import { valueOf, required, invoke, objectValue } from './value.js'
import type { Value } from './value.js'
import type { DiagnosticKey, DiagnosticValue, DiagnosticProperty } from './api.js'
function keyOf(key: string | symbol, symbols: Map<symbol, number>): DiagnosticKey {
  if (typeof key === 'string') return { kind: 'string', value: key }
  if (!symbols.has(key)) symbols.set(key, symbols.size + 1)
  return { kind: 'symbol', id: required(symbols.get(key)), description: key.description ?? null }
}
export function diagnostic<T>(value: T): DiagnosticValue {
  const objects = new WeakMap<object, number>()
  const symbols = new Map<symbol, number>()
  let nextId = 1
  function visit<T>(value: T, depth = 0): DiagnosticValue {
    const input = valueOf(value)
    if (input === undefined) return { kind: 'undefined' }
    if (input === null) return { kind: 'null' }
    if (typeof input === 'boolean') return { kind: 'boolean', value: input }
    if (typeof input === 'string') return { kind: 'string', value: input }
    if (typeof input === 'number')
      return {
        kind: 'number',
        value: Object.is(input, -0)
          ? '-0'
          : Number.isNaN(input)
            ? 'NaN'
            : input === Infinity
              ? 'Infinity'
              : input === -Infinity
                ? '-Infinity'
                : input,
      }
    if (typeof input === 'bigint') return { kind: 'bigint', value: String(input) }
    if (typeof input === 'symbol') return keyOf(input, symbols)
    if (objects.has(input)) return { kind: 'reference', id: required(objects.get(input)) }
    const id = nextId++
    objects.set(input, id)
    if (typeof input === 'function') return { kind: 'function', id, name: input.name || '' }
    if (input instanceof Date)
      return {
        kind: 'date',
        id,
        value: Number.isNaN(Date.prototype.getTime.call(input)) ? null : Date.prototype.toISOString.call(input),
      }
    if (input instanceof RegExp) {
      const get = (name: string) =>
        invoke(required(required(Object.getOwnPropertyDescriptor(RegExp.prototype, name)).get), input, [])
      const flags = [
        ['hasIndices', 'd'],
        ['global', 'g'],
        ['ignoreCase', 'i'],
        ['multiline', 'm'],
        ['dotAll', 's'],
        ['unicode', 'u'],
        ['unicodeSets', 'v'],
        ['sticky', 'y'],
      ]
        .filter(([name]) => get(name))
        .map(([, letter]) => letter)
        .join('')
      return { kind: 'regexp', id, source: String(get('source')), flags }
    }
    if (depth >= 8) return { kind: 'omitted', reason: 'depth limit' }
    if (input instanceof Map)
      return {
        kind: 'map',
        id,
        entries: [...Map.prototype.entries.call(input)].map(([k, v]) => [visit(k, depth + 1), visit(v, depth + 1)]),
      }
    if (input instanceof Set)
      return { kind: 'set', id, values: [...Set.prototype.values.call(input)].map((v) => visit(v, depth + 1)) }
    const properties: DiagnosticProperty[] = []
    const omitted: string[] = []
    if (input instanceof Error)
      for (const key of ['name', 'message', 'cause', 'stack']) {
        let source: object | null = input,
          desc
        while (source && !desc) {
          desc = Object.getOwnPropertyDescriptor(source, key)
          const prototype: Value = valueOf(Object.getPrototypeOf(source))
          source = prototype === null ? null : objectValue(prototype)
        }
        if (desc)
          properties.push({
            key: { kind: 'string', value: key },
            value:
              'value' in desc ? visit(desc.value, depth + 1) : { kind: 'accessor', get: !!desc.get, set: !!desc.set },
          })
      }
    for (const key of Reflect.ownKeys(input)) {
      const desc = Object.getOwnPropertyDescriptor(input, key)
      if (!desc?.enumerable) continue
      if (Array.isArray(input) && typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)) continue
      if (input instanceof Error && ['name', 'message', 'cause', 'stack'].includes(String(key))) continue
      if (properties.length >= 100) {
        omitted.push(String(key))
        continue
      }
      properties.push({
        key: keyOf(key, symbols),
        value: 'value' in desc ? visit(desc.value, depth + 1) : { kind: 'accessor', get: !!desc.get, set: !!desc.set },
      })
    }
    if (Array.isArray(input)) {
      const items = Array.from({ length: input.length }, (_, index): DiagnosticValue => {
        const desc = Object.getOwnPropertyDescriptor(input, index)
        return !desc
          ? { kind: 'hole' }
          : 'value' in desc
            ? visit(desc.value, depth + 1)
            : { kind: 'accessor', get: !!desc.get, set: !!desc.set }
      })
      return { kind: 'array', id, items, properties }
    }
    let type = 'Object'
    const ctor = valueOf(
      Object.getOwnPropertyDescriptor(valueOf(Object.getPrototypeOf(input)) ?? {}, 'constructor')?.value,
    )
    if (typeof ctor === 'function')
      type = String(valueOf(Object.getOwnPropertyDescriptor(ctor, 'name')?.value) || 'Object')
    return { kind: 'object', id, type, properties, omitted }
  }
  return visit(value)
}
