import type { DiagnosticProperty, DiagnosticValue } from '@hanamaru/runner/domain/result/types'
import { formatValue } from './format-value.js'

type DiffValue = DiagnosticValue | { readonly kind: 'missing' }
const missing = { kind: 'missing' } satisfies DiffValue
const scalarKinds = new Set<DiagnosticValue['kind']>([
  'undefined',
  'null',
  'hole',
  'boolean',
  'number',
  'bigint',
  'string',
  'date',
  'regexp',
])

function propertyPath(path: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}${path ? '.' : ''}${key}` : `${path}[${JSON.stringify(key)}]`
}

function stringProperties(properties: readonly DiagnosticProperty[]): Map<string, DiagnosticValue> | undefined {
  const values = new Map<string, DiagnosticValue>()
  for (const property of properties) {
    if (property.key.kind !== 'string') return
    values.set(property.key.value, property.value)
  }
  return values
}

function display(value: DiffValue): string {
  return value.kind === 'missing' ? '<missing>' : formatValue(value)
}

/** Diagnostic snapshots support precise paths for plain data; opaque values keep the full diagnostic. */
export function formatDiff(expected: DiagnosticValue, actual: DiagnosticValue, mode: 'equal' | 'partial'): string[] {
  const lines: string[] = []
  let count = 0,
    truncated = false
  function change(path: string, wanted: DiffValue, received: DiffValue) {
    if (count === 20) {
      truncated = true
      return
    }
    count++
    lines.push(path || '<root>', `- expected: ${display(wanted)}`, `+ actual:   ${display(received)}`)
  }
  function walk(wanted: DiffValue, received: DiffValue, path: string): boolean {
    if (wanted.kind === 'missing' || received.kind === 'missing') {
      if (wanted.kind !== received.kind) change(path, wanted, received)
      return true
    }
    if (
      (wanted.kind === 'hole' || wanted.kind === 'undefined') &&
      (received.kind === 'hole' || received.kind === 'undefined')
    )
      return true
    if (mode === 'partial' && wanted.kind === 'regexp') return false
    if (
      ![wanted, received].every(
        (value) => scalarKinds.has(value.kind) || value.kind === 'array' || value.kind === 'object',
      )
    )
      return false
    if (wanted.kind !== received.kind) {
      change(path, wanted, received)
      return true
    }
    if (wanted.kind === 'array' && received.kind === 'array') {
      if (wanted.properties.length || received.properties.length) return false
      for (let index = 0; index < Math.max(wanted.items.length, received.items.length); index++) {
        if (!walk(wanted.items[index] ?? missing, received.items[index] ?? missing, `${path}[${index}]`)) return false
      }
      return true
    }
    if (wanted.kind === 'object' && received.kind === 'object') {
      if (
        wanted.omitted.length ||
        received.omitted.length ||
        wanted.type !== 'Object' ||
        (mode === 'equal' && received.type !== 'Object')
      )
        return false
      const left = stringProperties(wanted.properties),
        right = stringProperties(received.properties)
      if (!left || !right) return false
      const keys = mode === 'partial' ? left.keys() : new Set([...left.keys(), ...right.keys()])
      for (const key of keys) {
        const a = left.get(key) ?? missing,
          b = right.get(key) ?? missing
        if (
          mode === 'equal' &&
          ((a.kind === 'missing' && b.kind === 'undefined') || (a.kind === 'undefined' && b.kind === 'missing'))
        )
          continue
        if (!walk(a, b, propertyPath(path, key))) return false
      }
      return true
    }
    if (!scalarKinds.has(wanted.kind)) return false
    if (formatValue(wanted) !== formatValue(received)) change(path, wanted, received)
    return true
  }
  if (!walk(expected, actual, '')) return []
  if (truncated) lines.push('… additional differences not shown')
  return lines
}
