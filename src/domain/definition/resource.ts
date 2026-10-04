import type { Fields } from './runtime.js'
import { resourceTag } from './tags.js'
import type { MiddlewareResult } from './types.js'
import { positive } from '../execution/config.js'
import type { Value } from '../../foundation/value.js'
import { property, valueOf } from '../../foundation/value.js'

export type ResourceScope = 'perRun' | 'perWorker'
export type JsonValue = null | boolean | string | number | readonly JsonValue[] | { readonly [key: string]: JsonValue }
export type JsonObject = { readonly [key: string]: JsonValue }

export interface ResourceNext {
  (): Promise<MiddlewareResult<{}>>
  <S extends JsonObject>(fields: S): Promise<MiddlewareResult<S>>
}

export interface Resource<S extends object = object, Scope extends ResourceScope = ResourceScope> {
  readonly [resourceTag]: true
  readonly name: string
  readonly scope: Scope
  readonly require: readonly Resource[]
  readonly timeout: number | undefined
  readonly setup: (ctx: never, next: ResourceNext) => Promise<MiddlewareResult<S>>
}

export type ResourceFields<R> = R extends Resource<infer S> ? S : never
export type ResourceContext<D extends readonly Resource[]> = D extends readonly [
  infer H,
  ...infer T extends readonly Resource[],
]
  ? ResourceFields<H> & ResourceContext<T>
  : D extends readonly []
    ? {}
    : ResourceFields<D[number]>

export function checkedResources(input: readonly Resource[] | undefined): readonly Resource[] {
  if (input === undefined) return []
  const resources: readonly Resource[] = input
  if (!Array.isArray(input)) throw new TypeError('resource requirements must be an array')
  for (const r of resources) {
    if (!r || r[resourceTag] !== true || !['perRun', 'perWorker'].includes(r.scope) || typeof r.setup !== 'function')
      throw new TypeError('require requires resource()')
    if (r.timeout !== undefined) positive(r.timeout, 'resource timeout')
  }
  return [...new Set(resources)]
}

/** 準備を始める前に依存を検査し、各定義を一度だけ依存順に並べる。 */
export function resourceGraph(roots: readonly Resource[]): Resource[] {
  const visiting = new Set<Resource>(),
    visited = new Set<Resource>(),
    ordered: Resource[] = []
  const visit = (r: Resource): void => {
    checkedResources([r])
    if (visiting.has(r)) throw new TypeError(`cyclic resource dependency: ${r.name}`)
    if (visited.has(r)) return
    visiting.add(r)
    for (const dep of checkedResources(r.require)) {
      if (r.scope === 'perRun' && dep.scope === 'perWorker')
        throw new TypeError(`perRun resource ${r.name} cannot require perWorker resource ${dep.name}`)
      visit(dep)
    }
    visiting.delete(r)
    visited.add(r)
    ordered.push(r)
  }
  for (const r of checkedResources(roots)) visit(r)
  return [...ordered.filter((r) => r.scope === 'perRun'), ...ordered.filter((r) => r.scope === 'perWorker')]
}

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
