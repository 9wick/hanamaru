import { expect, expectTypeOf, test } from 'vite-plus/test'
import { Test, middleware } from '../../index.js'
import { invoke, objectValue, property } from '../../domain/definition/javascript.js'

const add = (a: number, b: number) => a + b

test('implicit and explicit pure targets preserve the same case contract', () => {
  const implicit = new Test().target(add).it('sum', (t) => t.args(1, 2).expect((e) => [e.result.toEqual(3)]))
  const explicit = new Test()
    .target(add)
    .pure()
    .it('sum', (t) => t.args(1, 2).expect((e) => [e.result.toEqual(3)]))
  expect(implicit.blueprint().characteristic).toBe('pure')
  expect(explicit.blueprint().characteristic).toBe('pure')
  expectTypeOf(implicit).toEqualTypeOf(explicit)
})

test('characteristic and declaration state survive configuration and context composition', () => {
  const selected = new Test()
    .target(add)
    .effectful()
    .timeout(500)
    .use(middleware(async (_, next) => next({ expected: 3 })))
  const suite = selected.it('sum', (t) => t.args(1, 2).expect((e) => [e.result.toEqual(e.ctx.expected)]))
  expectTypeOf(suite.blueprint().characteristic).toEqualTypeOf<'effectful'>()
  expectTypeOf<'pure'>().not.toExtend<keyof typeof selected>()
  expectTypeOf<'effectful'>().not.toExtend<keyof typeof suite>()
  expect(suite.blueprint().characteristic).toBe('effectful')
})

test('declaring a characteristic is immutable and only legal once before cases', () => {
  const base = new Test().target(add)
  const pure = base.pure(),
    effectful = base.effectful()
  expect(() => invoke(objectValue(property(pure, 'effectful')), pure, [])).toThrow('already declared')
  expect(() => invoke(objectValue(property(effectful, 'effectful')), effectful, [])).toThrow('already declared')
  const completed = pure.it('sum', (t) => t.args(1, 2).expect((e) => [e.result.toEqual(3)]))
  expect(() => invoke(objectValue(property(completed, 'pure')), completed, [])).toThrow('before cases')
  const unselected = new Test()
  expect(() => invoke(objectValue(property(unselected, 'pure')), unselected, [])).toThrow('after target')
  expect(
    effectful.it('other', (t) => t.args(1, 2).expect((e) => [e.result.toEqual(3)])).blueprint().characteristic,
  ).toBe('effectful')
})

test('class targets require a receiver before exposing cases and preserve declaration state', () => {
  class Service {
    run(value: number) {
      return value + 1
    }
  }
  const pending = new Test().target(Service, 'run')
  expectTypeOf<'it'>().not.toExtend<keyof typeof pending>()
  expectTypeOf<'property'>().not.toExtend<keyof typeof pending>()
  const bound = pending.from(() => new Service())
  expectTypeOf<'from'>().not.toExtend<keyof typeof bound>()
  const selected = bound.effectful()
  expectTypeOf<'pure'>().not.toExtend<keyof typeof selected>()
  const suite = selected.it('increment', (t) => t.args(1).expect((e) => [e.result.toEqual(2)]))
  expect(suite.blueprint().characteristic).toBe('effectful')
  expect(() => invoke(objectValue(property(bound, 'from')), bound, [() => new Service()])).toThrow('already set')
  expect(() => invoke(objectValue(property(pending, 'it')), pending, ['missing receiver', () => null])).toThrow(
    'requires from',
  )
})

test('blueprint target descriptors cannot replace the declared function', () => {
  const suite = new Test().target(add).it('sum', (t) => t.args(1, 2).expect((e) => [e.result.toEqual(3)]))
  const target = suite.blueprint().target
  expect(Reflect.set(target, 'fn', () => 99)).toBe(false)
  expect(suite.blueprint().target).toBe(target)
})

test('example settings close when arguments are selected', () => {
  new Test().target(add).it('closed settings', (t) => {
    const args = t.timeout(100).retry(1).args(1, 2)
    expectTypeOf<'timeout'>().not.toExtend<keyof typeof args>()
    expectTypeOf<'retry'>().not.toExtend<keyof typeof args>()
    expect(() => invoke(objectValue(property(args, 'timeout')), args, [10])).toThrow('before input')
    expect(() => invoke(objectValue(property(args, 'retry')), args, [2])).toThrow('before input')
    return args.expect((e) => [e.result.toEqual(3)])
  })
})
