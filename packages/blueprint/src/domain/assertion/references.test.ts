import { expect, expectTypeOf, test } from 'vite-plus/test'
import { ObservationIssuer, ObservationOwner } from '../definition/observation.js'
import {
  actionReference,
  checkedReference,
  indexedReference,
  reference,
  referenceGraph,
  referenceTermination,
  stateReference,
} from './references.js'
import type { Ref } from './references.js'

test('keeps the input type and path without reading actual values', () => {
  const owner = new ObservationOwner()
  const result = reference<{ id: string; nested: { count: number } }, 'result'>(owner, { kind: 'result' })
  expectTypeOf(result.field('nested').field('count')).toEqualTypeOf<Ref<number, 'result'>>()
  const selected = checkedReference(result.field('id'), owner)
  expect(referenceGraph([selected], owner).map((ref) => ref.source.kind)).toEqual(['result', 'field'])
  expect(() => String(result)).toThrow('not measured')
})

test('parameterized state keeps dependencies on input and result and rejects foreign references', () => {
  const owner = new ObservationOwner(),
    scope = new ObservationIssuer(owner)
  let reads = 0
  const read = (id: string) => {
    reads++
    return { id, balance: 10 }
  }
  const state = scope.state({ evidence: 'real-effect', read })
  const id = reference<string, 'result'>(owner, { kind: 'result' })
  const bound = stateReference(owner, state, [id])
  expectTypeOf(bound).toEqualTypeOf<Ref<{ id: string; balance: number }, 'state'>>()
  expect(referenceGraph([checkedReference(bound, owner)], owner).map((ref) => ref.source.kind)).toEqual([
    'result',
    'state',
  ])
  expect(reads).toBe(0)
  const foreign = indexedReference<string, 'input'>(new ObservationOwner(), 'input', 0)
  expect(() => stateReference(owner, state, [foreign])).toThrow('another evaluation')
})

test('compile rejects contradictory termination requirements through nested references', () => {
  const owner = new ObservationOwner()
  const result = checkedReference(reference<{ name: string }, 'result'>(owner, { kind: 'result' }).field('name'), owner)
  const error = checkedReference(reference<unknown, 'error'>(owner, { kind: 'error' }), owner)
  const outcome = checkedReference(reference<unknown, 'outcome'>(owner, { kind: 'outcome' }), owner)
  expect(referenceTermination([result], owner)).toBe('return')
  expect(referenceTermination([error], owner)).toBe('throw')
  expect(referenceTermination([outcome], owner)).toBe('return-or-throw')
  expect(() => referenceTermination([result, error], owner)).toThrow('cannot be mixed')
  expect(() => referenceTermination([error, outcome], owner)).toThrow('cannot be mixed')
  const prefix = checkedReference(
    reference<string, 'step'>(owner, { kind: 'step', operation: 0, terminal: false }),
    owner,
  )
  expect(referenceTermination([prefix, error], owner)).toBe('throw')
})

test('observations require a live owner and a finite recording window', () => {
  const owner = new ObservationOwner(),
    scope = new ObservationIssuer(owner)
  const events = scope.action({ evidence: 'call-record', open: () => ({ finish: () => ['a'], dispose: () => {} }) })
  expect(() => actionReference(owner, events, { kind: 'after', milliseconds: Infinity })).toThrow('finite')
  expectTypeOf(actionReference(owner, events, { kind: 'settled' })).toEqualTypeOf<Ref<readonly string[], 'action'>>()
  const ref = indexedReference<number, 'sample'>(owner, 'sample', 0)
  owner.close()
  expect(() => checkedReference(ref, owner)).toThrow('completed')
  expect(() => indexedReference(owner, 'input', -1)).toThrow()
})
