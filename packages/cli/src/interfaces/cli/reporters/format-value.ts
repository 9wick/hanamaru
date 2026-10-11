import type { DiagnosticProperty, DiagnosticValue, TargetOutcome } from '@hanamaru/execution/domain/result/types'

const outcomeVerbs = { return: 'returned', throw: 'threw' } as const

interface ErrorShape {
  readonly name: string
  readonly message: string
  readonly cause: DiagnosticValue | null
}

function namedProperty(properties: readonly DiagnosticProperty[], key: string): DiagnosticValue | null {
  const found = properties.find((property) => property.key.kind === 'string' && property.key.value === key)
  return found ? found.value : null
}

/**
 * DiagnosticValueにはError由来かどうかの印が残らないため、diagnostic()がErrorに対してだけ作る形で判定する。
 * Errorのときは name / message / cause / stack をこの順で他のプロパティより先に積む。
 */
function errorShape(value: DiagnosticValue): ErrorShape | null {
  if (value.kind !== 'object' || value.properties.length < 2) return null
  const [name, message] = value.properties
  if (name.key.kind !== 'string' || name.key.value !== 'name' || name.value.kind !== 'string') return null
  if (message.key.kind !== 'string' || message.key.value !== 'message' || message.value.kind !== 'string') return null
  if (!namedProperty(value.properties, 'stack')) return null
  return { name: name.value.value, message: message.value.value, cause: namedProperty(value.properties, 'cause') }
}

function formatError(shape: ErrorShape): string {
  const headline = shape.message ? `${shape.name}: ${shape.message}` : shape.name
  return shape.cause === null ? headline : `${headline} (cause: ${formatValue(shape.cause)})`
}

function formatProperty(property: DiagnosticProperty): string {
  const key = property.key.kind === 'string' ? property.key.value : formatValue(property.key)
  return `${key}: ${formatValue(property.value)}`
}

export function formatValue(value: DiagnosticValue | TargetOutcome | TargetOutcome['kind']): string {
  if (typeof value === 'string') return outcomeVerbs[value]
  switch (value.kind) {
    case 'return':
    case 'throw':
      return `${outcomeVerbs[value.kind]} ${formatValue(value.value)}`
    case 'undefined':
      return 'undefined'
    case 'null':
      return 'null'
    case 'hole':
      return '<hole>'
    case 'number':
    case 'bigint':
    case 'boolean':
      return String(value.value)
    case 'string':
      return JSON.stringify(value.value)
    case 'symbol':
      return `Symbol(${value.description ?? ''})#${value.id}`
    case 'function':
      return `[Function ${value.name || '<anonymous>'}]`
    case 'reference':
      return `[Reference #${value.id}]`
    case 'date':
      return `Date(${value.value ?? 'Invalid'})`
    case 'regexp':
      return `/${value.source}/${value.flags}`
    case 'accessor':
      return `[accessor get=${value.get} set=${value.set}]`
    case 'omitted':
      return `[omitted: ${value.reason}]`
    case 'array':
      return `[${value.items.map((item) => formatValue(item)).join(', ')}]`
    case 'map':
      return `Map(${value.entries.map(([key, item]) => `${formatValue(key)} => ${formatValue(item)}`).join(', ')})`
    case 'set':
      return `Set(${value.values.map((item) => formatValue(item)).join(', ')})`
    case 'object': {
      const shape = errorShape(value)
      if (shape) return formatError(shape)
      // Errorとして1行にできなかった値もstackだけは読む価値がないので落とす。
      const properties = value.properties.filter((p) => p.key.kind !== 'string' || p.key.value !== 'stack')
      return `${value.type === 'Object' ? '' : value.type}{ ${properties.map(formatProperty).join(', ')} }`
    }
  }
}
