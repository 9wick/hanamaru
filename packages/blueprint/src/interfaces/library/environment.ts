import type { MiddlewareOptions } from '../../domain/definition/types.js'
import { positive } from '../../domain/definition/conditions.js'
import { middlewareTag } from '../../domain/definition/tags.js'

import type { Environment, EnvironmentFn } from '../../domain/definition/types.js'
export type { Environment, EnvironmentFn } from '../../domain/definition/types.js'

export function environment<C, S extends object>(
  run: EnvironmentFn<C, S>,
  options: MiddlewareOptions = {},
): Environment<C, S> {
  if (typeof run !== 'function') throw new TypeError('environment requires a function')
  const timeout = options.timeout === undefined ? undefined : positive(options.timeout, 'environment timeout')
  const value: Environment<C, S> = { [middlewareTag]: true, kind: 'environment', run, timeout }
  return Object.freeze(value)
}
