import { expect, expectTypeOf, test } from 'vite-plus/test'
import { ObservationOwner } from './observation.js'
import { compileSteps } from './steps.js'
import type { StepScope, FinalStepRef } from './steps.js'

type Scope = StepScope<{ target: (n: number) => { value: number } }, {}, readonly [number]>

test('step plans preserve declaration order including discarded operations', () => {
  const owner = new ObservationOwner()
  const plan = compileSteps(
    owner,
    ['target'],
    (s: Scope) => {
      s.target.args(0)
      const first = s.target.args(s.input[0])
      return { first, last: s.target.final(first.field('value')) }
    },
    {},
    [3],
  )
  expect(plan.operations.map((operation) => operation.index)).toEqual([0, 1, 2])
  expect(plan.operations[2]?.args[0]?.kind).toBe('reference')
  expect(plan.final?.index).toBe(2)
  expect(Object.isFrozen(plan.operations)).toBe(true)
  expectTypeOf<'field'>().not.toExtend<keyof FinalStepRef<number>>()
})

test('compile rejects operations after final and final not returned', () => {
  expect(() =>
    compileSteps(
      new ObservationOwner(),
      ['target'],
      (s: Scope) => {
        s.target.final(1)
        return s.target.args(2)
      },
      {},
      [1],
    ),
  ).toThrow('last operation')
  expect(() =>
    compileSteps(
      new ObservationOwner(),
      ['target'],
      (s: Scope) => {
        const first = s.target.args(1)
        s.target.final(2)
        return first
      },
      {},
      [1],
    ),
  ).toThrow('must be returned')
})

test('step references cannot cross evaluation ownership and result accessors are not executed', () => {
  const first = compileSteps(new ObservationOwner(), ['target'], (s: Scope) => s.target.args(1), {}, [1])
  expect(() => compileSteps(new ObservationOwner(), ['target'], () => first.output, {}, [1])).toThrow(
    'another evaluation',
  )
  let reads = 0
  expect(() =>
    compileSteps(
      new ObservationOwner(),
      ['target'],
      (s: Scope) => {
        const result = s.target.args(1)
        return {
          get result() {
            reads++
            return result
          },
        }
      },
      {},
      [1],
    ),
  ).toThrow('data record')
  expect(reads).toBe(0)
})
