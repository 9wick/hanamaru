import type { ItDone } from './types.js'
import { expect, expectTypeOf, test } from 'vite-plus/test'
import { Test, integers, strings, tuples } from '../../index.js'
import { PropertyCaseBuilder } from './property-builder.js'

test('property input must bind to target parameters before expect is available', () => {
  const add = (a: number, b: number) => a + b
  const suite = new Test().target(add).property('sum', (p) => {
    expectTypeOf<'expect'>().not.toExtend<keyof typeof p>()
    const generated = p.forAll(tuples(integers(), integers()), { seed: 7, runs: 2 })
    expectTypeOf<'expect'>().toExtend<keyof typeof generated>()
    expectTypeOf<'forAll'>().not.toExtend<keyof typeof generated>()
    return generated.expect((e) => [e.on(e.result).satisfies('finite', Number.isFinite)])
  })
  const item = suite.blueprint().cases[0]
  expect.assert(item.mode !== 'todo')
  expect.assert(item.args.kind === 'generated')
  expect(item.args.input.seed).toBe(7)
  expect(item.args.input.runs).toBe(2)
  expect(item.args.binding.kind).toBe('sample')
  new Test().target(add).property('different input', (p) => {
    const generated = p.forAll(tuples(strings()))
    expectTypeOf<'expect'>().not.toExtend<keyof typeof generated>()
    const bound = generated.argsFrom((_, sample) => [sample[0].length, 1])
    expectTypeOf<'argsFrom'>().not.toExtend<keyof typeof bound>()
    return bound.expect((e) => [e.on(e.result).satisfies('positive', (value) => value > 0)])
  })
})

test('runtime property definitions reject missing or repeated stages', () => {
  const builder = new PropertyCaseBuilder({ kind: 'function', fn: (n: number) => n })
  expect(() => builder.expect(() => [])).toThrow('requires forAll')
  const generated = builder.forAll(tuples(integers()))
  expect(() => generated.forAll(tuples())).toThrow('already set')
  const bound = generated.argsFrom(() => [1])
  expect(() => bound.argsFrom(() => [2])).toThrow('already set')
  const completed = generated.expect(() => [])
  expect(() => completed.expect(() => [])).toThrow('already complete')
})

test('completed properties cannot be moved to a different target', () => {
  let completed: ItDone | undefined
  new Test()
    .target((n: number) => n)
    .property('original', (p) => {
      completed = p.forAll(tuples(integers())).expect((e) => [e.on(e.result).satisfies('finite', Number.isFinite)])
      return completed
    })
  expect.assert(completed !== undefined)
  const foreign = completed
  expect(() => new Test().target((n: number) => n + 1).property('foreign', () => foreign)).toThrow('another target')
})

test('property settings close when forAll selects the input', () => {
  const builder = new PropertyCaseBuilder({ kind: 'function', fn: (n: number) => n })
  const generated = builder.timeout(100).retry(1).forAll(tuples(integers()))
  expect(() => generated.timeout(10)).toThrow('before forAll')
  expect(() => generated.retry(2)).toThrow('before forAll')
})
