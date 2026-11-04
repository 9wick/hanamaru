import { expect, expectTypeOf, test } from 'vite-plus/test'
import { method, scenario, MethodOperation, ScenarioDefinition } from './scenario.js'
import type { Method, ScenarioFunctions, ScenarioReceivers } from './scenario.js'

test('scenario preserves the declared functions and typed instance requirements', () => {
  class Service {
    run(text: string) {
      return text.length
    }
  }
  const members = { add: (a: number, b: number) => a + b, register: method(Service, 'run') }
  expectTypeOf<ScenarioFunctions<typeof members>['register']>().toEqualTypeOf<(text: string) => number>()
  expectTypeOf<ScenarioReceivers<typeof members>>().toEqualTypeOf<{ register: Service }>()
  expectTypeOf(members.register).toEqualTypeOf<Method<Service['run'], Service>>()
  const declared = scenario(members)
  expect(declared).toBeInstanceOf(ScenarioDefinition)
  expect(members.register).toBeInstanceOf(MethodOperation)
  const runtime = new ScenarioDefinition(members)
  expect(runtime.members.add).toBe(members.add)
  expect(Object.isFrozen(runtime.members)).toBe(true)
})

test('scenario does not execute member getters or accept empty and nonfunction members', () => {
  let reads = 0
  expect(
    () =>
      new ScenarioDefinition({
        get run() {
          reads++
          return () => 1
        },
      }),
  ).toThrow('data properties')
  expect(reads).toBe(0)
  expect(() => new ScenarioDefinition({})).toThrow('at least one')
  expect(() => new ScenarioDefinition({ run: 1 })).toThrow()
})
