import { expect, expectTypeOf, test } from 'vite-plus/test'
import { ObservationIssuer, ObservationOwner } from '../definition/observation.js'
import { stateReference, checkedReference } from './references.js'
import { expectation, StateSubject } from './expectation.js'
import { compileChecks } from './compiled-checks.js'

const create = (_name: string) => ({ id: 'generated' })

test('the example surface excludes property predicates and pure targets exclude observations', () => {
  const owner = new ObservationOwner()
  const e = expectation<typeof create, {}>(owner, {}, 'pure')
  expectTypeOf<'state'>().not.toExtend<keyof typeof e>()
  expectTypeOf<'on'>().not.toExtend<keyof typeof e>()
  expect('state' in e).toBe(false)
  expect('on' in e).toBe(false)
  expect(compileChecks([e.result.part('id').toEqual('generated')], owner, 'pure', 'example').termination).toBe('return')
})

test('effectful cases bind generated result fields to typed observation parameters', () => {
  const owner = new ObservationOwner(),
    scope = new ObservationIssuer(owner)
  const saved = scope.state({ evidence: 'substitute-effect', read: (id: string) => ({ id, name: 'Alice' }) })
  const deliveries = scope.action<string>({
    evidence: 'substitute-effect',
    open: () => ({ finish: () => [], dispose: () => {} }),
  })
  scope.seal()
  const context = { saved, deliveries }
  const e = expectation<typeof create, typeof context>(owner, context, 'effectful')
  const compiled = compileChecks(
    [
      e.state(e.ctx.saved, e.result.field('id')).part('name').toEqual('Alice'),
      e.action(e.ctx.deliveries).untilTargetSettles().count(1),
    ],
    owner,
    'effectful',
    'example',
  )
  expect(compiled.references.some((ref) => ref.source.kind === 'state')).toBe(true)
  expect(compiled.references.some((ref) => ref.source.kind === 'action')).toBe(true)
  const selected = e.state(saved, e.result.field('id'))
  expectTypeOf<'unchanged'>().not.toExtend<keyof typeof selected>()
  if (!(selected instanceof StateSubject)) throw new Error('expected a state subject')
  expect(() => compileChecks([selected.unchanged()], owner, 'effectful', 'example')).toThrow('before observations')
})

test('state-only cases complete and invalid waiting intervals are rejected', () => {
  const owner = new ObservationOwner(),
    scope = new ObservationIssuer(owner)
  const count = scope.state({ evidence: 'real-effect', read: () => 1 })
  const e = expectation<typeof create, {}>(owner, {}, 'effectful')
  const compiled = compileChecks([e.state(count).unchanged()], owner, 'effectful', 'example')
  expect(compiled.termination).toBe('return')
  expect(compiled.references.filter((ref) => ref.source.kind === 'state')).toHaveLength(2)
  expect(() => e.state(count).eventually({ withinMs: 10, intervalMs: 20 })).toThrow('intervals')
})

test('checkpoint selection cannot silently become a baseline observation', () => {
  const owner = new ObservationOwner(),
    scope = new ObservationIssuer(owner)
  const token = scope.state({ evidence: 'real-effect', read: () => 0 })
  const source = checkedReference(stateReference(owner, token, []), owner).source
  if (source.kind !== 'state') throw new Error('expected state')
  const baseline = new StateSubject<number>(owner, { ...source, timing: { kind: 'before' } })
  const checkpoint = new StateSubject<number>(owner, {
    ...source,
    timing: { kind: 'after-step', step: baseline },
  })
  expect(() => checkpoint.before()).toThrow('before requires')
  expect(() => checkpoint.eventually({ withinMs: 10, intervalMs: 1 })).toThrow('untimed after-plan')
})
