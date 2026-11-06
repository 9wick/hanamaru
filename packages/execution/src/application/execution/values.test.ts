import { expect, test } from 'vite-plus/test'
import { ObservationIssuer, ObservationOwner, propertyExpectation } from '@hanamaru/blueprint/model'
import { Subject, ErrorSubject } from '../../../../blueprint/src/domain/assertion/subjects.js'
import { Condition, compileChecks } from '../../../../blueprint/src/domain/assertion/compiled-checks.js'
import { reference, checkedReference, actionReference } from '../../../../blueprint/src/domain/assertion/references.js'
import { EvaluationValues, evaluateCheck } from './values.js'

test('result snapshots and selected fields retain the values produced before later changes', () => {
  const owner = new ObservationOwner()
  const result = new Subject<{ name: string }, 'result'>(owner, { kind: 'result' })
  const checks = [result.toEqual({ name: 'Alice' }), result.part('name').toEqual('Alice')]
  const values = new EvaluationValues(compileChecks(checks, owner, 'pure', 'example'))
  const actual = { name: 'Alice' }
  values.supply(result, actual)
  actual.name = 'Wrong'
  expect(checks.map((check) => evaluateCheck(check.check, values).status)).toEqual(['passed', 'passed'])
})

test('missing properties cannot pass as undefined and getter faults are reported', () => {
  const owner = new ObservationOwner()
  const result = new Subject<{ value: number | undefined }, 'result'>(owner, { kind: 'result' })
  const check = result.part('value').toEqual(undefined)
  const values = new EvaluationValues(compileChecks([check], owner, 'pure', 'example'))
  values.supply(result, {})
  expect(evaluateCheck(check.check, values)).toMatchObject({ status: 'failed', reason: 'property path is missing' })
  const getterValues = new EvaluationValues(compileChecks([check], owner, 'pure', 'example'))
  const cause = new Error('read failed')
  getterValues.supply(result, {
    get value() {
      throw cause
    },
  })
  expect(evaluateCheck(check.check, getterValues)).toEqual({ status: 'error', phase: 'observe', cause })
})

test('exception narrowing does not execute a projection for the wrong exception type', () => {
  class Denied extends Error {
    code = 'denied'
  }
  const owner = new ObservationOwner(),
    error = new ErrorSubject(owner, { kind: 'error' })
  const check = error.ofType(Denied).part('code').toEqual('denied')
  const values = new EvaluationValues(compileChecks([check], owner, 'pure', 'example'))
  values.supply(error, new Error('other'))
  expect(evaluateCheck(check.check, values)).toMatchObject({
    status: 'failed',
    reason: 'exception type does not match',
  })
})

test('predicate exceptions and absent values are distinct from a false predicate', () => {
  const owner = new ObservationOwner()
  const result = checkedReference(reference(owner, { kind: 'result' }), owner)
  const cause = new Error('predicate failed')
  const checks = [
    new Condition(owner, { kind: 'predicate', refs: result, name: 'false', predicate: () => false }),
    new Condition(owner, {
      kind: 'predicate',
      refs: result,
      name: 'throw',
      predicate: () => {
        throw cause
      },
    }),
  ]
  const values = new EvaluationValues(compileChecks(checks, owner, 'pure', 'property'))
  expect(evaluateCheck(checks[0].check, values).status).toBe('not-evaluated')
  values.supply(result, 1)
  expect(evaluateCheck(checks[0].check, values).status).toBe('failed')
  expect(evaluateCheck(checks[1].check, values)).toEqual({ status: 'error', phase: 'assert', cause })
})

test('counts are captured immediately and cannot follow changes in a provider array', () => {
  const owner = new ObservationOwner(),
    scope = new ObservationIssuer(owner)
  const token = scope.action({ evidence: 'real-effect', open: () => ({ finish: () => [], dispose: () => {} }) })
  const result = checkedReference(actionReference(owner, token, { kind: 'settled' }), owner)
  const check = new Condition(owner, { kind: 'count', ref: result, expected: 1 })
  const values = new EvaluationValues(compileChecks([check], owner, 'effectful', 'example'))
  const events = ['one']
  values.supply(result, events)
  events.push('two')
  expect(evaluateCheck(check.check, values).status).toBe('passed')
})

test('property outcome projection evaluates both exits and preserves narrowing failures', () => {
  class TooLong extends Error {
    readonly length: number
    constructor(length: number) {
      super('too long')
      this.length = length
    }
  }
  const owner = new ObservationOwner()
  const e = propertyExpectation<(text: string) => string, {}, readonly [string]>(owner, {}, 'pure')
  let projections = 0
  const condition = e
    .on(
      e.outcome.withError(TooLong, (error) => {
        projections++
        return error.length
      }),
    )
    .satisfies('short or rejected', (exit) => (exit.kind === 'return' ? exit.value.length <= 8 : exit.error > 8))
  const compiled = compileChecks([condition], owner, 'pure', 'property')
  const success = new EvaluationValues(compiled)
  success.supply(e.outcome, { kind: 'return', value: 'short' })
  expect(evaluateCheck(condition.check, success).status).toBe('passed')
  const failure = new EvaluationValues(compiled)
  failure.supply(e.outcome, { kind: 'throw', error: new TooLong(9) })
  expect(evaluateCheck(condition.check, failure).status).toBe('passed')
  const wrong = new EvaluationValues(compiled)
  wrong.supply(e.outcome, { kind: 'throw', error: new Error('unexpected') })
  expect(evaluateCheck(condition.check, wrong).status).toBe('failed')
  expect(projections).toBe(1)
})
