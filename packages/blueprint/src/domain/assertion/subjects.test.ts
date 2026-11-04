import { expect, expectTypeOf, test } from 'vite-plus/test'
import { ObservationOwner } from '../definition/observation.js'
import { Subject, ErrorSubject } from './subjects.js'
import { compileChecks } from './compiled-checks.js'
import type { Condition } from './compiled-checks.js'
import { referenceGraph, checkedReference } from './references.js'

test('exact value subjects preserve types and offer no negation or arbitrary predicates', () => {
  const owner = new ObservationOwner()
  const result = new Subject<{ amount: number }, 'result'>(owner, { kind: 'result' })
  expectTypeOf(result.part('amount').toEqual(5)).toEqualTypeOf<Condition<'return'>>()
  expectTypeOf<'not'>().not.toExtend<keyof typeof result>()
  expectTypeOf<'toSatisfy'>().not.toExtend<keyof typeof result>()
  expect('not' in result).toBe(false)
  expect(
    compileChecks([result.part('amount').toBeCloseTo(5, { absoluteTolerance: 0.01 })], owner, 'pure', 'example')
      .termination,
  ).toBe('return')
})

test('error type narrowing is a reference dependency evaluated before its fields', () => {
  class Denied extends Error {
    code = 'denied'
  }
  const owner = new ObservationOwner()
  const error = new ErrorSubject(owner, { kind: 'error' })
  const code = error.ofType(Denied).field('code')
  expect(referenceGraph([checkedReference(code, owner)], owner).map((ref) => ref.source.kind)).toEqual([
    'error',
    'error-type',
    'field',
  ])
  expectTypeOf(error.ofType(Denied).part('code').toEqual('denied')).toEqualTypeOf<Condition<'throw'>>()
  expect(compileChecks([error.message.toEqual('no')], owner, 'pure', 'example').termination).toBe('throw')
})
