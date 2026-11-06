import type { ValueImage } from '@hanamaru/blueprint/model'
import type { DiagnosticKey, DiagnosticProperty, DiagnosticValue } from './types.js'
import { diagnostic } from './diagnostic.js'
import { valueOf } from '../execution/javascript.js'

/** 比較時に保存した表現だけを読み、後から変更された実体には触れない。 */
export function imageDiagnostic(image: ValueImage): DiagnosticValue {
  const visited = new Set<number>()
  const symbols = new Map<symbol, number>()
  const functions = new Map<object, number>()
  const enteredNodes: number[] = [],
    enteredFunctions: object[] = []
  let nextId = image.nodes.size + 1
  function keyOf(key: PropertyKey): DiagnosticKey {
    if (typeof key !== 'symbol') return { kind: 'string', value: String(key) }
    const id = symbols.get(key) ?? symbols.size + 1
    symbols.set(key, id)
    return { kind: 'symbol', id, description: key.description ?? null }
  }
  function visit(edge: ValueImage['root'], depth: number): DiagnosticValue {
    const nodesBefore = enteredNodes.length,
      functionsBefore = enteredFunctions.length
    try {
      return inspect(edge, depth)
    } catch (cause) {
      while (enteredNodes.length > nodesBefore) {
        const id = enteredNodes.pop()
        if (id !== undefined) visited.delete(id)
      }
      while (enteredFunctions.length > functionsBefore) {
        const fn = enteredFunctions.pop()
        if (fn !== undefined) functions.delete(fn)
      }
      const detail = diagnostic(cause)
      const message =
        detail.kind === 'object'
          ? detail.properties.find((property) => property.key.kind === 'string' && property.key.value === 'message')
              ?.value
          : detail
      return {
        kind: 'omitted',
        reason:
          message?.kind === 'string' ? `inspection failed: ${message.value}` : 'comparison image inspection failed',
      }
    }
  }
  function inspect(edge: ValueImage['root'], depth: number): DiagnosticValue {
    if (edge.kind === 'value') {
      if (typeof edge.value === 'symbol') return keyOf(edge.value)
      if (typeof edge.value !== 'function') return diagnostic(edge.value)
      const previous = functions.get(edge.value)
      if (previous !== undefined) return { kind: 'reference', id: previous }
      const name = valueOf(Object.getOwnPropertyDescriptor(edge.value, 'name')?.value)
      const id = nextId++
      functions.set(edge.value, id)
      enteredFunctions.push(edge.value)
      return { kind: 'function', id, name: typeof name === 'string' ? name : '<accessor>' }
    }
    const id = edge.id + 1
    if (visited.has(id)) return { kind: 'reference', id }
    if (depth >= 8) return { kind: 'omitted', reason: 'depth limit' }
    const node = image.nodes.get(edge.id)
    if (!node) throw new TypeError('invalid comparison image reference')
    visited.add(id)
    enteredNodes.push(id)
    const payload = node.payload
    if (payload.kind === 'date')
      return { kind: 'date', id, value: Number.isNaN(payload.time) ? null : new Date(payload.time).toISOString() }
    if (payload.kind === 'regexp')
      return { kind: 'regexp', id, source: String(payload.source), flags: String(payload.flags) }
    if (payload.kind === 'map')
      return { kind: 'map', id, entries: payload.entries.map(([k, v]) => [visit(k, depth + 1), visit(v, depth + 1)]) }
    if (payload.kind === 'set') return { kind: 'set', id, values: payload.entries.map((v) => visit(v, depth + 1)) }
    const properties: DiagnosticProperty[] = []
    const omitted: string[] = []
    for (const [key, slot] of node.properties) {
      if (payload.kind === 'array' && (key === 'length' || /^(0|[1-9]\d*)$/.test(String(key)))) continue
      if (properties.length >= 100) {
        omitted.push(String(key))
        continue
      }
      properties.push({
        key: keyOf(key),
        value:
          slot.kind === 'data' ? visit(slot.value, depth + 1) : { kind: 'accessor', get: !!slot.get, set: !!slot.set },
      })
    }
    if (payload.kind === 'array') {
      const length = node.properties.get('length')
      if (length?.kind !== 'data' || length.value.kind !== 'value' || typeof length.value.value !== 'number')
        throw new TypeError('invalid array comparison image')
      const items = Array.from({ length: length.value.value }, (_, index): DiagnosticValue => {
        const slot = node.properties.get(String(index))
        return !slot
          ? { kind: 'hole' }
          : slot.kind === 'data'
            ? visit(slot.value, depth + 1)
            : { kind: 'accessor', get: !!slot.get, set: !!slot.set }
      })
      return { kind: 'array', id, items, properties }
    }
    if (payload.kind === 'bytes')
      properties.push({
        key: { kind: 'string', value: 'bytes' },
        value: {
          kind: 'array',
          id: nextId++,
          items: payload.bytes.map((value) => ({ kind: 'number', value })),
          properties: [],
        },
      })
    const ctor =
      node.prototype === null ? null : valueOf(Object.getOwnPropertyDescriptor(node.prototype, 'constructor')?.value)
    const name = typeof ctor === 'function' ? valueOf(Object.getOwnPropertyDescriptor(ctor, 'name')?.value) : null
    return { kind: 'object', id, type: typeof name === 'string' ? name : 'Object', properties, omitted }
  }
  return visit(image.root, 0)
}
