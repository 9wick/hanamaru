import * as v from 'valibot'
import { plannedCalls } from './calls.js'
import { checkedRelation } from './relation.js'
import type { Value } from './javascript.js'
import { arrayValue, functionValue, nonempty, objectValue, property } from './javascript.js'
import type { RuntimeCallAssertion } from '../assertion/runtime.js'
import { checkedCall, validateAssertion } from '../assertion/validation.js'
import type { ExecutionConfig } from './conditions.js'
import { positive, retryCount } from './conditions.js'
import { methodValue } from './operations.js'
import type {
  RuntimeBehavior,
  RuntimeBlueprint,
  RuntimeDefinitionHandle,
  RuntimeMiddleware,
  RuntimeMock,
} from './runtime.js'
import { behaviorTag, middlewareTag } from './tags.js'
import type { BehaviorBlueprint, SourceLocation } from './types.js'

export function checkedMiddleware(value: object): RuntimeMiddleware {
  const timeout = v.parse(v.optional(v.number()), property(value, 'timeout'))
  return { [middlewareTag]: true, kind: 'middleware', run: functionValue(property(value, 'run')), timeout }
}

export function checkedBehavior(input: Value, completed = true): RuntimeBehavior {
  const value = objectValue(input)
  if (completed && property(value, behaviorTag) !== true)
    throw new TypeError('mock builder must return a completed behavior')
  const kind = property(value, 'kind')
  switch (kind) {
    case 'returns':
    case 'resolves':
      return { [behaviorTag]: true, kind, value: property(value, 'value') }
    case 'throws':
    case 'rejects':
      return { [behaviorTag]: true, kind, error: property(value, 'error') }
    case 'callsFake':
      return { [behaviorTag]: true, kind, fn: functionValue(property(value, 'fn')) }
    case 'sequence': {
      const action = (entry: Value) => {
        const result = checkedBehavior(entry, false)
        if (result.kind === 'sequence') throw new TypeError('nested mock sequence')
        return result
      }
      return {
        [behaviorTag]: true,
        kind,
        once: nonempty(arrayValue(property(value, 'once')).map(action)),
        fallback: action(property(value, 'fallback')),
      }
    }
    default:
      throw new TypeError('invalid mock behavior')
  }
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

function validBehavior(value: BehaviorBlueprint) {
  if (!value || typeof value !== 'object') throw new TypeError('invalid mock behavior')
  if (value.kind === 'sequence') {
    if (!Array.isArray(value.once) || !value.once.length) throw new TypeError('empty mock sequence')
    value.once.forEach(validBehavior)
    validBehavior(value.fallback)
    if (property(value.fallback, 'kind') === 'sequence') throw new TypeError('nested mock sequence')
  } else if (!['returns', 'resolves', 'throws', 'rejects', 'callsFake'].includes(value.kind))
    throw new TypeError('invalid mock action')
  else if (value.kind === 'callsFake' && typeof value.fn !== 'function') throw new TypeError('invalid mock fake')
}

function validMocks(mocks: RuntimeMock[]) {
  if (!Array.isArray(mocks)) throw new TypeError('invalid mocks')
  for (const mock of mocks) {
    if (!mock || typeof mock.key !== 'string') throw new TypeError('invalid mock target')
    methodValue(mock.object, mock.key)
    validBehavior(mock.behavior)
  }
}

function validCalls(calls: readonly RuntimeCallAssertion[]) {
  if (!Array.isArray(calls)) throw new TypeError('invalid call conditions')
  for (const call of arrayValue(calls).map(checkedCall)) {
    if (!validateAssertion(call) || call.subject !== 'call' || typeof call.key !== 'string')
      throw new TypeError('invalid call condition')
    if (call.object !== undefined) methodValue(call.object, call.key)
    if (call.check.matcher === 'calledNthWith' && (!Number.isSafeInteger(call.check.n) || call.check.n < 1))
      throw new TypeError('invalid call index')
    if (call.check.matcher === 'calledTimes' && (!Number.isSafeInteger(call.check.count) || call.check.count < 0))
      throw new TypeError('invalid call count')
  }
}

export function validateBlueprint(bp: RuntimeBlueprint, ancestors = new Set<RuntimeBlueprint>()) {
  if (!bp || typeof bp !== 'object' || bp.version !== 1 || !['test', 'group', 'definition'].includes(bp.kind))
    throw new TypeError('invalid blueprint')
  if (ancestors.has(bp)) throw new TypeError('cyclic blueprint')
  ancestors.add(bp)
  validConfig(bp.config)
  validMocks(bp.mocks)
  if (
    !Array.isArray(bp.steps) ||
    bp.steps.some((step) => step?.[middlewareTag] !== true || typeof step.run !== 'function')
  )
    throw new TypeError('invalid middleware steps')
  bp.steps.forEach((step) => step.timeout === undefined || positive(step.timeout, 'middleware timeout'))
  if (bp.kind === 'test') {
    if (
      !bp.target ||
      (bp.target.kind !== 'relation' && typeof bp.target.fn !== 'function') ||
      !Array.isArray(bp.cases) ||
      !bp.cases.length
    )
      throw new TypeError('invalid test blueprint')
    if (bp.target.kind === 'relation') checkedRelation(bp.target)
    for (const item of bp.cases) {
      validOrigin(item.origin)
      validConfig(item.config)
      if (!['run', 'only', 'skip', 'todo'].includes(item.mode)) throw new TypeError('invalid case mode')
      if (item.mode !== 'todo') {
        validMocks(item.mocks)
        validCalls(item.calls)
        if (
          !item.args ||
          !['value', 'from-context', 'calls'].includes(item.args.kind) ||
          (item.args.kind === 'from-context' && typeof item.args.build !== 'function')
        )
          throw new TypeError('invalid case args')
        if (item.args.kind === 'calls') plannedCalls(item.args, bp.target)
        else if (bp.target.kind === 'relation') throw new TypeError('relation cases require calls()')
        if (!item.expect && !item.calls.length) throw new TypeError('case has no expectation')
      }
    }
  } else {
    if (!Array.isArray(bp.children) || !bp.children.length) throw new TypeError('empty blueprint children')
    if (bp.kind === 'group') {
      validOrigin(bp.origin)
      if (
        bp.middleware !== null &&
        (bp.middleware?.[middlewareTag] !== true || typeof bp.middleware.run !== 'function')
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
