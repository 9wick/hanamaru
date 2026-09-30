import * as v from 'valibot'
import type { Value } from '../../foundation/value.js'
import { arrayValue, functionValue, objectValue, property } from '../../foundation/value.js'
import { methodValue } from '../definition/operations.js'
import { assertionTag } from '../definition/tags.js'
import type { CallCheck, RuntimeCallAssertion, RuntimeValueAssertion } from './runtime.js'

export function validateCalls(calls: readonly RuntimeCallAssertion[]): readonly RuntimeCallAssertion[] {
  if (!calls.length) throw new TypeError('expectCalls must return a nonempty array of call assertions')
  for (const item of calls) {
    if (item.object !== undefined) methodValue(item.object, item.key)
    if (item.check.matcher === 'calledNthWith' && (!Number.isSafeInteger(item.check.n) || item.check.n < 1))
      throw new TypeError('calledNthWith index must be positive')
    if (item.check.matcher === 'calledTimes' && (!Number.isSafeInteger(item.check.count) || item.check.count < 0))
      throw new TypeError('calledTimes count must be nonnegative')
  }
  return calls
}

export function validateAssertion<T>(value: T): boolean {
  return typeof value === 'object' && value !== null && property(value, assertionTag) === true
}

export function checkedAssertion(input: Value): RuntimeValueAssertion {
  const value = objectValue(input)
  if (!validateAssertion(value)) throw new TypeError('invalid assertion')
  const subject = v.parse(v.picklist(['result', 'error']), property(value, 'subject'))
  const check = objectValue(property(value, 'check'))
  const matcher = property(check, 'matcher')
  switch (matcher) {
    case 'toBe':
    case 'toEqual':
    case 'toMatchObject':
      return { [assertionTag]: true, subject, check: { matcher, expected: property(check, 'expected') } }
    case 'toSatisfy':
      return {
        [assertionTag]: true,
        subject,
        check: { matcher, predicate: functionValue(property(check, 'predicate')) },
      }
    case 'toThrow':
      return {
        [assertionTag]: true,
        subject,
        check: { matcher, message: v.parse(v.union([v.string(), v.instance(RegExp)]), property(check, 'message')) },
      }
    case 'toBeInstanceOf': {
      const ctor = objectValue(property(check, 'ctor'))
      return { [assertionTag]: true, subject, check: { matcher, ctor } }
    }
    default:
      throw new TypeError('invalid assertion matcher')
  }
}

export function checkedCall(input: Value): RuntimeCallAssertion {
  const value = objectValue(input)
  if (!validateAssertion(value) || property(value, 'subject') !== 'call') throw new TypeError('invalid call assertion')
  const target =
    property(value, 'objectFrom') === undefined
      ? { object: objectValue(property(value, 'object')) }
      : { objectFrom: functionValue(property(value, 'objectFrom')) }
  const key = v.parse(v.string(), property(value, 'key'))
  const check = objectValue(property(value, 'check')),
    matcher = property(check, 'matcher')
  const args = () =>
    property(check, 'argsFrom') === undefined
      ? { args: arrayValue(property(check, 'args')) }
      : { argsFrom: functionValue(property(check, 'argsFrom')) }
  let condition: CallCheck
  switch (matcher) {
    case 'notCalled':
      condition = { matcher }
      break
    case 'calledTimes':
      condition = { matcher, count: v.parse(v.number(), property(check, 'count')) }
      break
    case 'calledWith':
    case 'calledOnceWith':
      condition = { matcher, ...args() }
      break
    case 'calledNthWith':
      condition = { matcher, n: v.parse(v.number(), property(check, 'n')), ...args() }
      break
    default:
      throw new TypeError('invalid call matcher')
  }
  return { [assertionTag]: true, subject: 'call', ...target, key, check: condition }
}
