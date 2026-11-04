import type { Value } from '../definition/javascript.js'
import { objectValue, valueOf } from '../definition/javascript.js'

type Edge = { readonly kind: 'value'; readonly value: Value } | { readonly kind: 'node'; readonly id: number }
type Slot =
  | { readonly kind: 'data'; readonly value: Edge }
  | { readonly kind: 'accessor'; readonly get: object | undefined; readonly set: object | undefined }
type Payload =
  | { readonly kind: 'object' | 'array' | 'typed-array' | 'error' }
  | { readonly kind: 'date'; readonly time: number }
  | { readonly kind: 'regexp'; readonly source: Value; readonly flags: Value }
  | { readonly kind: 'bytes'; readonly bytes: readonly number[] }
  | { readonly kind: 'map'; readonly entries: readonly (readonly [Edge, Edge])[] }
  | { readonly kind: 'set'; readonly entries: readonly Edge[] }
interface Node {
  readonly prototype: object | null
  readonly properties: ReadonlyMap<PropertyKey, Slot>
  readonly payload: Payload
}
export interface ValueImage {
  readonly root: Edge
  readonly nodes: ReadonlyMap<number, Node>
}

function inheritedDescriptor(value: object, key: PropertyKey): PropertyDescriptor | undefined {
  let current: object | null = value
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key)
    if (descriptor !== undefined) return descriptor
    const prototype = valueOf(Object.getPrototypeOf(current))
    current = prototype === null ? null : objectValue(prototype)
  }
  return undefined
}
function intrinsic(prototype: object, key: PropertyKey, receiver: object): Value {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, key)
  if (descriptor?.get === undefined) throw new TypeError('missing intrinsic getter')
  return valueOf(Reflect.apply(descriptor.get, receiver, []))
}

/** 比較表現には生の可変データを残さず、prototype・関数・symbolの同一性だけを保持する。 */
export function captureValue(input: Value): ValueImage {
  const ids = new Map<object, number>()
  const nodes = new Map<number, Node>()
  function capture(value: Value): Edge {
    if (typeof value !== 'object' || value === null) return { kind: 'value', value }
    const previous = ids.get(value)
    if (previous !== undefined) return { kind: 'node', id: previous }
    const id = ids.size
    ids.set(value, id)
    const rawPrototype = valueOf(Object.getPrototypeOf(value))
    const prototype = rawPrototype === null ? null : objectValue(rawPrototype)
    const properties = new Map<PropertyKey, Slot>()
    const keys = Reflect.ownKeys(value).filter((key) => !(value instanceof Error && key === 'stack'))
    if (value instanceof Error) for (const key of ['name', 'message', 'cause']) if (!keys.includes(key)) keys.push(key)
    for (const key of keys) {
      const descriptor =
        value instanceof Error ? inheritedDescriptor(value, key) : Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined) continue
      properties.set(
        key,
        'value' in descriptor
          ? { kind: 'data', value: capture(valueOf(descriptor.value)) }
          : { kind: 'accessor', get: descriptor.get, set: descriptor.set },
      )
    }
    let payload: Payload
    if (Array.isArray(value)) payload = { kind: 'array' }
    else if (value instanceof Date) payload = { kind: 'date', time: Date.prototype.getTime.call(value) }
    else if (value instanceof RegExp)
      payload = {
        kind: 'regexp',
        source: intrinsic(RegExp.prototype, 'source', value),
        flags: [
          ['hasIndices', 'd'],
          ['global', 'g'],
          ['ignoreCase', 'i'],
          ['multiline', 'm'],
          ['dotAll', 's'],
          ['unicode', 'u'],
          ['unicodeSets', 'v'],
          ['sticky', 'y'],
        ]
          .filter(([key]) => intrinsic(RegExp.prototype, key, value) === true)
          .map(([, flag]) => flag)
          .join(''),
      }
    else if (value instanceof Map) {
      const entries: Iterable<readonly [unknown, unknown]> = Map.prototype.entries.call(value)
      payload = {
        kind: 'map',
        entries: Array.from(entries, ([key, item]) => [capture(valueOf(key)), capture(valueOf(item))]),
      }
    } else if (value instanceof Set) {
      const entries: Iterable<unknown> = Set.prototype.values.call(value)
      payload = { kind: 'set', entries: Array.from(entries, (item) => capture(valueOf(item))) }
    } else if (value instanceof ArrayBuffer) payload = { kind: 'bytes', bytes: Array.from(new Uint8Array(value)) }
    else if (value instanceof DataView) {
      const buffer = intrinsic(DataView.prototype, 'buffer', value)
      const offset = intrinsic(DataView.prototype, 'byteOffset', value)
      const length = intrinsic(DataView.prototype, 'byteLength', value)
      if (
        !(buffer instanceof ArrayBuffer || buffer instanceof SharedArrayBuffer) ||
        typeof offset !== 'number' ||
        typeof length !== 'number'
      )
        throw new TypeError('invalid native view range')
      payload = { kind: 'bytes', bytes: Array.from(new Uint8Array(buffer, offset, length)) }
    } else if (ArrayBuffer.isView(value)) payload = { kind: 'typed-array' }
    else if (value instanceof Error) payload = { kind: 'error' }
    else {
      if (prototype !== null && prototype !== Object.prototype && properties.size === 0)
        throw new TypeError('opaque-value: provide a valueAdapter for values without public data')
      payload = { kind: 'object' }
    }
    nodes.set(id, { prototype, properties, payload })
    return { kind: 'node', id }
  }
  return { root: capture(input), nodes }
}

export function equalValues(left: ValueImage, right: ValueImage): boolean {
  function edge(a: Edge, b: Edge, seen: Set<string>): boolean {
    if (a.kind === 'value') return b.kind === 'value' && Object.is(a.value, b.value)
    if (b.kind !== 'node') return false
    const pair = `${a.id}:${b.id}`
    if (seen.has(pair)) return true
    seen.add(pair)
    const x = left.nodes.get(a.id),
      y = right.nodes.get(b.id)
    if (!x || !y) throw new TypeError('invalid comparison image reference')
    if (x.prototype !== y.prototype || x.properties.size !== y.properties.size || x.payload.kind !== y.payload.kind)
      return false
    for (const [key, value] of x.properties) {
      const other = y.properties.get(key)
      if (!other || value.kind !== other.kind) return false
      if (value.kind === 'data') {
        if (other.kind !== 'data' || !edge(value.value, other.value, seen)) return false
      } else if (other.kind !== 'accessor' || value.get !== other.get || value.set !== other.set) return false
    }
    const p = x.payload,
      q = y.payload
    switch (p.kind) {
      case 'object':
      case 'array':
      case 'typed-array':
      case 'error':
        return true
      case 'date':
        return q.kind === 'date' && Object.is(p.time, q.time)
      case 'regexp':
        return q.kind === 'regexp' && Object.is(p.source, q.source) && Object.is(p.flags, q.flags)
      case 'bytes':
        return (
          q.kind === 'bytes' &&
          p.bytes.length === q.bytes.length &&
          p.bytes.every((value, index) => value === q.bytes[index])
        )
      case 'map':
        return (
          q.kind === 'map' &&
          unordered(
            p.entries,
            q.entries,
            seen,
            (a, b, visited) => edge(a[0], b[0], visited) && edge(a[1], b[1], visited),
          )
        )
      case 'set':
        return q.kind === 'set' && unordered(p.entries, q.entries, seen, edge)
    }
  }
  return edge(left.root, right.root, new Set())
}

function unordered<T>(
  left: readonly T[],
  right: readonly T[],
  seen: Set<string>,
  compare: (a: T, b: T, seen: Set<string>) => boolean,
): boolean {
  if (left.length !== right.length) return false
  const used = new Set<number>()
  for (const item of left) {
    let matched = false
    for (const [index, other] of right.entries()) {
      if (used.has(index)) continue
      const trial = new Set(seen)
      if (!compare(item, other, trial)) continue
      used.add(index)
      for (const pair of trial) seen.add(pair)
      matched = true
      break
    }
    if (!matched) return false
  }
  return true
}

/** 操作ごとに保存した像を合成し、後続操作による変更を結果レコードへ持ち込まない。 */
export function recordImage(fields: Readonly<Record<string, ValueImage>>): ValueImage {
  const nodes = new Map<number, Node>()
  const properties = new Map<PropertyKey, Slot>()
  nodes.set(0, { prototype: Object.prototype, properties, payload: { kind: 'object' } })
  for (const [key, image] of Object.entries(fields)) {
    const ids = new Map<number, number>()
    for (const id of image.nodes.keys()) ids.set(id, nodes.size + ids.size)
    function edge(value: Edge): Edge {
      if (value.kind === 'value') return value
      const id = ids.get(value.id)
      if (id === undefined) throw new TypeError('invalid comparison image reference')
      return { kind: 'node', id }
    }
    for (const [oldId, node] of image.nodes) {
      const id = ids.get(oldId)
      if (id === undefined) throw new TypeError('invalid comparison image node')
      const payload =
        node.payload.kind === 'map'
          ? ({ kind: 'map', entries: node.payload.entries.map(([k, v]) => [edge(k), edge(v)] as const) } as const)
          : node.payload.kind === 'set'
            ? ({ kind: 'set', entries: node.payload.entries.map(edge) } as const)
            : node.payload
      nodes.set(id, {
        ...node,
        payload,
        properties: new Map(
          Array.from(node.properties, ([k, slot]) => [
            k,
            slot.kind === 'data' ? { kind: 'data', value: edge(slot.value) } : slot,
          ]),
        ),
      })
    }
    properties.set(key, { kind: 'data', value: edge(image.root) })
  }
  return { root: { kind: 'node', id: 0 }, nodes }
}
