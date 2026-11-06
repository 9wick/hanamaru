import { expect, test } from 'vite-plus/test'
import { ObservationIssuer, ObservationOwner, checkedState } from '../definition/observation.js'
import { Condition, closeCondition, compileChecks, equalCondition } from './compiled-checks.js'
import { actionReference, checkedReference, indexedReference, reference, stateReference } from './references.js'
import { captureValue, equalValues } from './value-image.js'

test('compile snapshots expected values before the target can mutate input', () => {
  const owner = new ObservationOwner()
  const result = checkedReference(reference(owner, { kind: 'result' }), owner)
  const expected = { name: 'Alice' }
  const condition = equalCondition(owner, result, expected)
  const compiled = compileChecks([condition], owner, 'pure', 'example')
  expected.name = 'Wrong'
  expect(compiled.termination).toBe('return')
  if (condition.check.kind !== 'equal') throw new Error('expected equality')
  expect(equalValues(condition.check.expected, captureValue({ name: 'Alice' }))).toBe(true)
  expect(equalValues(condition.check.expected, captureValue(expected))).toBe(false)
})

test('rejects property predicates in examples and properties with no observed result', () => {
  const owner = new ObservationOwner()
  const input = checkedReference(indexedReference(owner, 'input', 0), owner)
  const condition = new Condition(owner, { kind: 'predicate', refs: input, name: 'always', predicate: () => true })
  expect(() => compileChecks([condition], owner, 'pure', 'example')).toThrow('inside it')
  expect(() => compileChecks([condition], owner, 'pure', 'property')).toThrow('must observe')
  expect(() => compileChecks([], owner, 'pure', 'example')).toThrow('at least one')
  expect(() => compileChecks([{ check: condition.check }], owner, 'pure', 'property')).toThrow('conditions')
})

test('checks temporal dependencies without invoking state readers', () => {
  const owner = new ObservationOwner(),
    scope = new ObservationIssuer(owner)
  let reads = 0
  const token = scope.state({
    evidence: 'real-effect',
    read: (_id: string) => {
      reads++
      return 1
    },
  })
  const result = checkedReference(reference(owner, { kind: 'result' }), owner)
  const before = checkedReference(
    reference(owner, {
      kind: 'state',
      token: checkedState(token, owner),
      args: [{ kind: 'reference', ref: result }],
      timing: { kind: 'before' },
    }),
    owner,
  )
  expect(() => compileChecks([equalCondition(owner, before, 1)], owner, 'effectful', 'example')).toThrow(
    'before observations',
  )
  const after = checkedReference(stateReference(owner, token, ['id']), owner)
  expect(() => compileChecks([equalCondition(owner, after, 1)], owner, 'pure', 'example')).toThrow('effectful')
  expect(compileChecks([equalCondition(owner, after, 1)], owner, 'effectful', 'example').termination).toBe('return')
  expect(reads).toBe(0)
})

test('one action cannot have incompatible recording intervals', () => {
  const owner = new ObservationOwner(),
    scope = new ObservationIssuer(owner)
  const token = scope.action({ evidence: 'substitute-effect', open: () => ({ finish: () => [], dispose: () => {} }) })
  const settled = checkedReference(actionReference(owner, token, { kind: 'settled' }), owner)
  const delayed = checkedReference(actionReference(owner, token, { kind: 'after', milliseconds: 50 }), owner)
  expect(() =>
    compileChecks(
      [equalCondition(owner, settled, []), equalCondition(owner, delayed, [])],
      owner,
      'effectful',
      'example',
    ),
  ).toThrow('conflicting')
})

test('rejects invalid numeric tolerances and foreign conditions', () => {
  const owner = new ObservationOwner(),
    other = new ObservationOwner()
  const result = checkedReference(reference(owner, { kind: 'result' }), owner)
  expect(() => closeCondition(owner, result, 1, -1)).toThrow('tolerance')
  expect(() => closeCondition(owner, result, Infinity, 0)).toThrow('finite')
  expect(() => compileChecks([equalCondition(owner, result, 1)], other, 'pure', 'example')).toThrow('this evaluation')
})
