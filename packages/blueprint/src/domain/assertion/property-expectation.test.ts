import { expect, expectTypeOf, test } from 'vite-plus/test'
import { ObservationIssuer, ObservationOwner } from '../definition/observation.js'
import { compileChecks } from './compiled-checks.js'
import { propertyExpectation } from './property-expectation.js'

const echo = (value: string) => value

test('property predicates receive typed samples and outputs, never input-only evidence', () => {
  const owner = new ObservationOwner()
  const e = propertyExpectation<typeof echo, {}, readonly [string]>(owner, {}, 'pure')
  const condition = e
    .on({ input: e.sample(0), output: e.result })
    .satisfies('preserves length', ({ input, output }) => {
      expectTypeOf(input).toEqualTypeOf<string>()
      return input.length === output.length
    })
  expect(compileChecks([condition], owner, 'pure', 'property').termination).toBe('return')
  expect(() =>
    compileChecks([e.on(e.sample(0)).satisfies('not about target', () => true)], owner, 'pure', 'property'),
  ).toThrow('must observe')
  expect(() => compileChecks([condition], owner, 'pure', 'example')).toThrow('inside it')
  expectTypeOf<Parameters<typeof e.on<{}>>[0]>().toBeNever()
  expectTypeOf(e.outcome).not.toExtend<Parameters<typeof e.on<unknown, 'outcome'>>[0]>()
})

test('mixed termination and projected exceptions retain their termination requirement', () => {
  const owner = new ObservationOwner()
  const e = propertyExpectation<typeof echo, {}, readonly [string]>(owner, {}, 'pure')
  const outcome = e.outcome.withError(TypeError, (error) => error.message)
  const condition = e.on(outcome).satisfies('expected result or type error', (value) => {
    expectTypeOf(value).toEqualTypeOf<
      { readonly kind: 'return'; readonly value: string } | { readonly kind: 'throw'; readonly error: string }
    >()
    return value.kind === 'return' ? value.value.length <= 8 : value.error === 'too long'
  })
  expect(compileChecks([condition], owner, 'pure', 'property').termination).toBe('return-or-throw')
  expect(() => compileChecks([condition, e.result.toEqual('')], owner, 'pure', 'property')).toThrow('cannot be mixed')
  const projected = e.project(e.error.ofType(TypeError), (error) => error.message)
  expect(
    compileChecks([e.on(projected).satisfies('message', (text) => text.length > 0)], owner, 'pure', 'property')
      .termination,
  ).toBe('throw')
})

test('property compares before and after observations but cannot use their reference identity', () => {
  const owner = new ObservationOwner()
  const scope = new ObservationIssuer(owner)
  const balance = scope.state({ evidence: 'real-effect', read: () => 0 })
  const e = propertyExpectation<typeof echo, {}, readonly [number]>(owner, {}, 'effectful')
  const state = e.state(balance)
  const condition = e
    .on({ before: state.before(), after: state, amount: e.sample(0) })
    .satisfies('credited amount', ({ before, after, amount }) => after === before + amount)
  expect(
    compileChecks([condition], owner, 'effectful', 'property').references.some((ref) => ref.source.kind === 'state'),
  ).toBe(true)
  expectTypeOf(state).not.toExtend<Parameters<typeof e.identity>[0]>()
  expectTypeOf(e.sample(0)).not.toExtend<Parameters<typeof e.identity>[0]>()
})
