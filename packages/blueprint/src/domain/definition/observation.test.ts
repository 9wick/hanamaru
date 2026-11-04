import { expect, expectTypeOf, test } from 'vite-plus/test'
import { ObservationIssuer, ObservationOwner, checkedAction, checkedState } from './observation.js'
import type { Action, State } from './observation.js'

test('keeps read parameters and event types while issuing descriptors without reading or subscribing', () => {
  const owner = new ObservationOwner(),
    scope = new ObservationIssuer(owner)
  let reads = 0,
    opens = 0
  const read = async (id: string) => {
    reads++
    return { id, balance: 10 }
  }
  const state = scope.state({ evidence: 'real-effect', read })
  const action = scope.action({
    evidence: 'substitute-effect',
    open: () => {
      opens++
      return { finish: () => [{ to: 'alice' }], dispose: () => {} }
    },
  })
  expectTypeOf(state).toEqualTypeOf<State<typeof read>>()
  expectTypeOf(action).toEqualTypeOf<Action<{ to: string }>>()
  expect(checkedState(state, owner).evidence).toBe('real-effect')
  expect(checkedAction(action, owner).evidence).toBe('substitute-effect')
  expect({ reads, opens }).toEqual({ reads: 0, opens: 0 })
  expect(Object.isFrozen(state)).toBe(true)
})

test('sealing one environment does not stop nested environments issuing for the same evaluation', () => {
  const owner = new ObservationOwner()
  const outer = new ObservationIssuer(owner),
    inner = new ObservationIssuer(owner)
  const state = outer.state({ evidence: 'real-effect', read: () => 1 })
  outer.seal()
  const nested = inner.state({ evidence: 'call-record', read: () => [] })
  inner.seal()
  expect(checkedState(state, owner).id).not.toBe(checkedState(nested, owner).id)
  expect(() => outer.state({ evidence: 'real-effect', read: () => 2 })).toThrow('before next')
  expect(() =>
    inner.action({ evidence: 'real-effect', open: () => ({ finish: () => [], dispose: () => {} }) }),
  ).toThrow('before next')
})

test('rejects forged, wrong-kind, stale and foreign evaluation tokens', () => {
  const first = new ObservationOwner(),
    second = new ObservationOwner()
  const scope = new ObservationIssuer(first)
  const state = scope.state({ evidence: 'real-effect', read: () => 1 })
  expect(() => checkedState({ kind: 'state' }, first)).toThrow()
  expect(() => checkedAction(state, first)).toThrow()
  expect(() => checkedState(state, second)).toThrow('another evaluation')
  first.close()
  expect(() => checkedState(state, first)).toThrow('completed evaluation')
  expect(() => scope.state({ evidence: 'real-effect', read: () => 2 })).toThrow('completed evaluation')
})
