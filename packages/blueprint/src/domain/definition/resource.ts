import { resourceTag } from './tags.js'
import type { MiddlewareResult } from './types.js'
import { positive } from './conditions.js'

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
