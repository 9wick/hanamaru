import type { DiagnosticKey, DiagnosticProperty, DiagnosticValue } from './types.js'

/** 独立して保存した診断値を、参照IDが衝突しない一つのレコードにまとめる。 */
export function diagnosticRecord(fields: readonly (readonly [string, DiagnosticValue])[]): DiagnosticValue {
  let nextId = 2,
    nextSymbol = 1
  const properties = fields.map(([name, root]): DiagnosticProperty => {
    const objects = new Map<number, number>(),
      symbols = new Map<number, number>()
    function id(previous: number): number {
      const found = objects.get(previous)
      if (found !== undefined) return found
      const assigned = nextId++
      objects.set(previous, assigned)
      return assigned
    }
    function key(value: DiagnosticKey): DiagnosticKey {
      if (value.kind === 'string') return value
      let assigned = symbols.get(value.id)
      if (assigned === undefined) {
        assigned = nextSymbol++
        symbols.set(value.id, assigned)
      }
      return { ...value, id: assigned }
    }
    function property(value: DiagnosticProperty): DiagnosticProperty {
      return { key: key(value.key), value: visit(value.value) }
    }
    function visit(value: DiagnosticValue): DiagnosticValue {
      if (value.kind === 'symbol') return key(value)
      if (!('id' in value)) return value
      const assigned = id(value.id)
      switch (value.kind) {
        case 'array':
          return { ...value, id: assigned, items: value.items.map(visit), properties: value.properties.map(property) }
        case 'object':
          return { ...value, id: assigned, properties: value.properties.map(property) }
        case 'map':
          return { ...value, id: assigned, entries: value.entries.map(([k, v]) => [visit(k), visit(v)]) }
        case 'set':
          return { ...value, id: assigned, values: value.values.map(visit) }
        default:
          return { ...value, id: assigned }
      }
    }
    return { key: { kind: 'string', value: name }, value: visit(root) }
  })
  return { kind: 'object', id: 1, type: 'Object', properties, omitted: [] }
}
