import type { AnyFn, ExecutionConfig, ResolvedExecutionConfig } from './api.js'
import type { Fields } from './internal.js'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const implementationRoot = dirname(fileURLToPath(import.meta.url))

export const definitionTag = Symbol('hanamaru definition')
export const middlewareTag = Symbol('hanamaru middleware')
export const resultTag = Symbol('hanamaru middleware result')
export const assertionTag = Symbol('hanamaru assertion')
export const behaviorTag = Symbol('hanamaru behavior')
export const doneTag = Symbol('hanamaru case done')

export function positive(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    throw new TypeError(`${name} must be a positive finite number`)
  return value
}
export function retryCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('retry must be a nonnegative safe integer')
  return value
}
export function location() {
  const lines = new Error().stack?.split('\n').slice(1) ?? []
  for (const line of lines) {
    const match = line.match(/(?:\(|at )((?:file:\/\/)?[^():]+):(\d+):(\d+)\)?$/)
    if (!match) continue
    let file = match[1]
    if (file.startsWith('file://')) file = fileURLToPath(file)
    if (file.startsWith(`${implementationRoot}/`) || file.startsWith('node:')) continue
    return { file, line: Number(match[2]), column: Number(match[3]) }
  }
  throw new Error('Cannot determine declaration location')
}
export function plainFields(value: unknown): Fields {
  if (value === undefined) return {}
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError('next(fields) requires a plain object')
  }
  return value as Fields
}
export function configWith(base: ResolvedExecutionConfig, own: ExecutionConfig): ResolvedExecutionConfig {
  return { timeout: own.timeout ?? base.timeout, retry: own.retry ?? base.retry }
}
export function methodValue(object: unknown, key: PropertyKey): AnyFn {
  if (object === null || (typeof object !== 'object' && typeof object !== 'function'))
    throw new TypeError('method target must be an object')
  let current = object
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key)
    if (descriptor) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function')
        throw new TypeError('method target must be a data property containing a function')
      return descriptor.value
    }
    current = Object.getPrototypeOf(current)
  }
  throw new TypeError('method target does not exist')
}

export function errorMessage(error: unknown): string {
  return String(error == null ? error : (Reflect.get(Object(error), 'message') ?? error))
}
export function errorStack(error: unknown): string {
  return String(error instanceof Error ? (error.stack ?? error.message) : error)
}
