import { expect, expectTypeOf, test } from 'vite-plus/test'
import { Test, scenario, method, tuples, integers } from '../../index.js'
import { invoke, objectValue, property } from '../../domain/definition/javascript.js'

test('scenario cases expose operations instead of single-call arguments and each', () => {
  const selected = new Test().target(scenario({ add: (a: number, b: number) => a + b }))
  expectTypeOf<'each'>().not.toExtend<keyof typeof selected>()
  expectTypeOf<'from'>().not.toExtend<keyof typeof selected>()
  selected
    .it('sum', (t) => {
      expectTypeOf<'args'>().not.toExtend<keyof typeof t>()
      return t
        .steps((s) => {
          expectTypeOf<'input'>().not.toExtend<keyof typeof s>()
          expectTypeOf<'target'>().not.toExtend<keyof typeof s>()
          return s.add.args(1, 2)
        })
        .expect((e) => {
          expectTypeOf<'on'>().not.toExtend<keyof typeof e>()
          expectTypeOf<'error'>().not.toExtend<keyof typeof e>()
          expectTypeOf<'input'>().not.toExtend<keyof typeof e>()
          return [e.result.toEqual(3)]
        })
    })
    .property('sum range', (p) => {
      const generated = p.forAll(tuples(integers(), integers()))
      expectTypeOf<'expect'>().not.toExtend<keyof typeof generated>()
      expectTypeOf<'argsFrom'>().not.toExtend<keyof typeof generated>()
      return generated
        .steps((s) => s.add.args(s.input[0], s.input[1]))
        .expect((e) => [e.on(e.result).satisfies('finite', Number.isFinite)])
    })
})

test('scenario methods require a receiver map and reject repeated from', () => {
  class Service {
    run(n: number) {
      return n
    }
  }
  const selected = new Test().target(scenario({ run: method(Service, 'run') }))
  expectTypeOf<'it'>().not.toExtend<keyof typeof selected>()
  const bound = selected.from(() => ({ run: new Service() }))
  expectTypeOf<'from'>().not.toExtend<keyof typeof bound>()
  const completed = bound.it('bound', (t) => t.steps((s) => s.run.args(1)).expect((e) => [e.result.toEqual(1)]))
  expect(completed.blueprint().target.kind).toBe('scenario')
  expect(() => invoke(objectValue(property(bound, 'from')), bound, [() => ({ run: new Service() })])).toThrow(
    'already set',
  )
  expect(() => invoke(objectValue(property(selected, 'it')), selected, ['missing receiver', () => null])).toThrow(
    'require from',
  )
})
