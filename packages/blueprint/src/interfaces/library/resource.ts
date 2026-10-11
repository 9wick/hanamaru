import type {
  JsonObject,
  Resource,
  ResourceContext,
  ResourceNext,
  ResourceScope,
} from '../../domain/definition/resource.js'
import { checkedResources } from '../../domain/definition/resource.js'
import { resourceTag } from '../../domain/definition/tags.js'
import type { MiddlewareResult } from '../../domain/definition/types.js'
import { positive } from '../../domain/definition/conditions.js'

export function resource<
  const D extends readonly Resource[] = readonly [],
  S extends JsonObject = JsonObject,
  Scope extends ResourceScope = ResourceScope,
>(options: {
  readonly name?: string
  readonly scope: Scope
  readonly require?: D
  readonly timeout?: number
  readonly setup: (ctx: Readonly<ResourceContext<D>>, next: ResourceNext) => Promise<MiddlewareResult<S>>
}): Resource<S, Scope> {
  if (!options || !['perRun', 'perWorker'].includes(options.scope))
    throw new TypeError('resource scope must be perRun or perWorker')
  if (typeof options.setup !== 'function') throw new TypeError('resource setup must be a function')
  if (options.name !== undefined && typeof options.name !== 'string')
    throw new TypeError('resource name must be a string')
  const value: Resource<S, Scope> = {
    [resourceTag]: true,
    name: options.name ?? options.setup.name ?? '<resource>',
    scope: options.scope,
    require: Object.freeze(checkedResources(options.require)),
    timeout: options.timeout === undefined ? undefined : positive(options.timeout, 'resource timeout'),
    setup: options.setup,
  }
  return Object.freeze(value)
}
