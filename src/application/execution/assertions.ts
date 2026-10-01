import * as v from 'valibot'
import type {
  ResolvedCallAssertion,
  RuntimeAssertion,
  RuntimeCallAssertion,
  RuntimeValueAssertion,
} from '../../domain/assertion/runtime.js'
import { checkedAssertion, validateAssertion } from '../../domain/assertion/validation.js'
import type { Fields, RuntimeCase } from '../../domain/definition/runtime.js'
import { diagnostic } from '../../domain/result/diagnostic.js'
import { assertionReferenceSchema, failureSchema } from '../../domain/result/schemas.js'
import type {
  AssertionReference,
  AssertionResult,
  ExecutionPhase,
  Failure,
  TargetOutcome,
} from '../../domain/result/types.js'
import { errorMessage } from '../../foundation/errors.js'
import type { Value } from '../../foundation/value.js'
import { arrayValue, functionValue, invoke, property, required, valueOf } from '../../foundation/value.js'
import type { Comparison } from '../ports/comparison.js'
import { MiddlewareFault } from './faults.js'

export function callReference(condition: RuntimeCallAssertion, index: number): AssertionReference {
  return { index, source: 'expectCalls', subject: 'call', key: condition.key, matcher: condition.check.matcher }
}

function expectationReference(condition: RuntimeValueAssertion, index: number): AssertionReference {
  return v.parse(assertionReferenceSchema, {
    index,
    source: 'expect',
    subject: condition.subject,
    matcher: condition.check.matcher,
  })
}

export function failure<K extends Failure['kind']>(
  kind: K,
  phase: Extract<Failure, { kind: K }>['phase'],
  message: string,
  more: Omit<Extract<Failure, { kind: K }>, 'kind' | 'phase' | 'message'>,
): Failure {
  return v.parse(failureSchema, { kind, phase, message, ...more })
}

function checkCondition(condition: RuntimeValueAssertion, actual: Value, { equal, matchObject }: Comparison) {
  const c = condition.check
  switch (c.matcher) {
    case 'toBe':
      return Object.is(actual, c.expected)
    case 'toEqual':
      return equal(actual, c.expected)
    case 'toMatchObject':
      return matchObject(actual, c.expected)
    case 'toSatisfy': {
      const result = invoke(c.predicate, undefined, [actual])
      if (result && typeof property(Object(result), 'then') === 'function')
        throw new TypeError('toSatisfy predicate must be synchronous')
      return result === true
    }
    case 'toBeInstanceOf':
      return actual instanceof functionValue(c.ctor)
    case 'toThrow':
      if (!(actual instanceof Error)) return false
      return typeof c.message === 'string'
        ? actual.message.includes(c.message)
        : new RegExp(c.message.source, c.message.flags).test(actual.message)
  }
  return false
}

function checkCalls(condition: ResolvedCallAssertion, history: Value[][], { equal }: Comparison) {
  const c = condition.check
  switch (c.matcher) {
    case 'calledTimes':
      return history.length === c.count
    case 'notCalled':
      return history.length === 0
    case 'calledWith':
      return history.some((args) => equal(args, c.args))
    case 'calledOnceWith':
      return history.length === 1 && equal(history[0], c.args)
    case 'calledNthWith':
      return history.length >= c.n && equal(history[c.n - 1], c.args)
  }
  return false
}

function snapshotExpected(condition: RuntimeAssertion) {
  const check = condition.check
  if ('expected' in check) return diagnostic(check.expected)
  if (check.matcher === 'calledOnceWith') return diagnostic({ count: 1, args: check.args })
  if (check.matcher === 'calledNthWith') return diagnostic({ n: check.n, args: check.args })
  if ('args' in check) return diagnostic(check.args)
  if ('count' in check) return diagnostic(check.count)
  if (check.matcher === 'notCalled') return diagnostic(0)
  if ('message' in check) return diagnostic(check.message)
  if ('ctor' in check) return diagnostic(check.ctor)
  if ('predicate' in check) return diagnostic(check.predicate)
  throw new TypeError('invalid assertion diagnostic')
}

function snapshotCalls(condition: ResolvedCallAssertion, history: Value[][]) {
  switch (condition.check.matcher) {
    case 'calledTimes':
    case 'notCalled':
      return diagnostic(history.length)
    case 'calledOnceWith':
      return diagnostic({ count: history.length, calls: history })
    case 'calledNthWith':
      return diagnostic({ count: history.length, args: history[condition.check.n - 1] ?? null })
    case 'calledWith':
      return diagnostic(history)
  }
}

export function evaluate(
  item: Omit<RuntimeCase, 'calls'> & { calls: readonly ResolvedCallAssertion[] },
  ctx: Readonly<Fields>,
  outcome: TargetOutcome,
  rawValue: Value,
  records: Map<object, Map<string, Value[][]>>,
  comparison: Comparison,
): { failures: Failure[]; assertions: AssertionResult[] } {
  const failures: Failure[] = [],
    assertions: AssertionResult[] = []
  let expected: readonly RuntimeValueAssertion[] = []
  if (item.expect) {
    try {
      expected = arrayValue(invoke(item.expect.build, undefined, [ctx])).map(checkedAssertion)
      if (
        !expected.length ||
        expected.some((x) => !validateAssertion(x) || !['result', 'error'].includes(x.subject)) ||
        new Set(expected.map((x) => x.subject)).size !== 1
      )
        throw new TypeError('expect must return nonempty result-only or error-only assertions')
    } catch (error) {
      failures.push(failure('execution', 'expect', 'expect failed', { cause: diagnostic(error) }))
      expected = []
    }
  }
  const wanted = expected[0]?.subject === 'error' ? 'throw' : 'return'
  if (outcome.kind !== wanted)
    failures.push(failure('outcome', 'target', 'unexpected target outcome', { expected: wanted, actual: outcome }))
  for (const [index, condition] of expected.entries()) {
    const ref = expectationReference(condition, index)
    if (outcome.kind !== wanted) {
      assertions.push({ assertion: ref, status: 'not-evaluated', reason: 'target outcome mismatch' })
      continue
    }
    try {
      const okay = checkCondition(condition, rawValue, comparison)
      const expectedValue = snapshotExpected(condition),
        actualValue = diagnostic(rawValue)
      assertions.push({
        assertion: ref,
        status: okay ? 'passed' : 'failed',
        expected: expectedValue,
        actual: actualValue,
      })
      if (!okay)
        failures.push(
          failure('assertion', 'assertion', 'expectation did not match', {
            assertion: ref,
            expected: expectedValue,
            actual: actualValue,
          }),
        )
    } catch (error) {
      failures.push(
        failure('execution', 'assertion', 'expectation threw', { cause: diagnostic(error), assertion: ref }),
      )
      assertions.push({
        assertion: ref,
        status: 'failed',
        expected: snapshotExpected(condition),
        actual: diagnostic(rawValue),
      })
    }
  }
  for (const [index, condition] of item.calls.entries()) {
    const ref = callReference(condition, index)
    const history = records.get(condition.object)?.get(condition.key) ?? []
    try {
      const okay = checkCalls(condition, history, comparison)
      const expectedValue = snapshotExpected(condition),
        actualValue = snapshotCalls(condition, history)
      assertions.push({
        assertion: ref,
        status: okay ? 'passed' : 'failed',
        expected: expectedValue,
        actual: actualValue,
      })
      if (!okay)
        failures.push(
          failure('assertion', 'assertion', 'call expectation did not match', {
            assertion: ref,
            expected: expectedValue,
            actual: actualValue,
          }),
        )
    } catch (error) {
      failures.push(
        failure('execution', 'assertion', 'call expectation threw', { cause: diagnostic(error), assertion: ref }),
      )
      assertions.push({
        assertion: ref,
        status: 'failed',
        expected: snapshotExpected(condition),
        actual: snapshotCalls(condition, history),
      })
    }
  }
  return { failures, assertions }
}

export function faultToFailure<T>(input: T, phase: ExecutionPhase = 'middleware'): Failure {
  const error = valueOf(input)
  if (error instanceof MiddlewareFault)
    return error.kind === 'timeout'
      ? failure('timeout', phase, error.message, {
          timeoutMs: required(error.timeoutMs),
          cleanup: 'complete',
          ...(error.stage === 'contract' ? {} : { stage: error.stage }),
        })
      : failure('execution', phase, error.message, { cause: diagnostic(error.cause) })
  return failure('execution', phase, errorMessage(error), { cause: diagnostic(error) })
}
