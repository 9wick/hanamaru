import * as v from 'valibot'
import { functionValue, property } from './javascript.js'
import type { ExecutionConfig } from './conditions.js'
import { positive, retryCount } from './conditions.js'
import type { RuntimeBlueprint, RuntimeDefinitionHandle, RuntimeMiddleware } from './runtime.js'
import { middlewareTag } from './tags.js'
import type { SourceLocation } from './types.js'

export function checkedMiddleware(value: object): RuntimeMiddleware {
  if (property(value, 'kind') !== 'middleware') throw new TypeError('group requires middleware, not environment')
  const timeout = v.parse(v.optional(v.number()), property(value, 'timeout'))
  return { [middlewareTag]: true, kind: 'middleware', run: functionValue(property(value, 'run')), timeout }
}

function validConfig(config: ExecutionConfig) {
  if (!config || typeof config !== 'object') throw new TypeError('invalid execution config')
  if (config.timeout !== undefined) positive(config.timeout, 'timeout')
  if (config.retry !== undefined) retryCount(config.retry)
}

function validOrigin(origin: SourceLocation) {
  if (
    !origin ||
    typeof origin.file !== 'string' ||
    !Number.isSafeInteger(origin.line) ||
    origin.line < 1 ||
    !Number.isSafeInteger(origin.column) ||
    origin.column < 1
  )
    throw new TypeError('invalid source location')
}

export function validateBlueprint(bp: RuntimeBlueprint, ancestors = new Set<RuntimeBlueprint>()) {
  if (!bp || typeof bp !== 'object' || bp.version !== 1 || !['test', 'group', 'definition'].includes(bp.kind))
    throw new TypeError('invalid blueprint')
  if (ancestors.has(bp)) throw new TypeError('cyclic blueprint')
  ancestors.add(bp)
  validConfig(bp.config)
  if (
    !Array.isArray(bp.steps) ||
    bp.steps.some(
      (step) =>
        step?.[middlewareTag] !== true ||
        !['middleware', 'environment'].includes(step.kind) ||
        typeof step.run !== 'function',
    )
  )
    throw new TypeError('invalid middleware steps')
  bp.steps.forEach((step) => step.timeout === undefined || positive(step.timeout, 'middleware timeout'))
  if (bp.steps.some((step) => step.kind === 'environment') && (bp.kind !== 'test' || bp.characteristic !== 'effectful'))
    throw new TypeError('environment requires an effectful target')
  if (bp.kind === 'test') {
    if (!['pure', 'effectful'].includes(bp.characteristic)) throw new TypeError('invalid target characteristic')
    if (bp.steps.some((step) => step.kind === 'environment') && bp.characteristic !== 'effectful')
      throw new TypeError('environment requires an effectful target')
    if (
      !bp.target ||
      !['function', 'method', 'instance', 'scenario'].includes(bp.target.kind) ||
      (bp.target.kind !== 'instance' && bp.target.kind !== 'scenario' && typeof bp.target.fn !== 'function') ||
      !Array.isArray(bp.cases) ||
      !bp.cases.length
    )
      throw new TypeError('invalid test blueprint')
    if (
      bp.target.kind === 'instance' &&
      (typeof bp.target.ctor !== 'function' ||
        typeof bp.target.from !== 'function' ||
        typeof bp.target.key !== 'string')
    )
      throw new TypeError('invalid class target or missing from')
    for (const item of bp.cases) {
      if (
        item.mode === 'todo'
          ? item.caseKind !== 'todo'
          : item.caseKind !== (item.args?.kind === 'generated' ? 'property' : 'example')
      )
        throw new TypeError('case kind does not match its input')
      validOrigin(item.origin)
      validConfig(item.config)
      if (!['run', 'only', 'skip', 'todo'].includes(item.mode)) throw new TypeError('invalid case mode')
      if (item.mode !== 'todo') {
        if (
          !item.args ||
          !['value', 'from-context', 'generated', 'steps'].includes(item.args.kind) ||
          (item.args.kind === 'from-context' && typeof item.args.build !== 'function')
        )
          throw new TypeError('invalid case args')
        if (
          bp.target.kind === 'scenario' &&
          item.args.kind !== 'steps' &&
          !(item.args.kind === 'generated' && item.args.binding.kind === 'steps')
        )
          throw new TypeError('scenario cases require steps')
        if (!item.expect || item.expect.kind !== 'contract' || typeof item.expect.build !== 'function')
          throw new TypeError('case requires a contract expectation')
      }
    }
  } else {
    if (!Array.isArray(bp.children) || !bp.children.length) throw new TypeError('empty blueprint children')
    if (bp.kind === 'group') {
      validOrigin(bp.origin)
      if (
        bp.middleware !== null &&
        (bp.middleware?.[middlewareTag] !== true ||
          bp.middleware.kind !== 'middleware' ||
          typeof bp.middleware.run !== 'function')
      )
        throw new TypeError('invalid group middleware')
      if (bp.middleware?.timeout !== undefined) positive(bp.middleware.timeout, 'middleware timeout')
    }
    if (bp.kind === 'group')
      for (const entry of bp.children) {
        validOrigin(entry.origin)
        validateBlueprint(entry.blueprint, ancestors)
      }
    else for (const entry of bp.children) validateBlueprint(entry, ancestors)
  }
  ancestors.delete(bp)
}

export function validatedBlueprints(definitions: readonly RuntimeDefinitionHandle[]): RuntimeBlueprint[] {
  const blueprints = definitions.map((definition) => definition.blueprint())
  blueprints.forEach((blueprint) => validateBlueprint(blueprint))
  return blueprints
}
