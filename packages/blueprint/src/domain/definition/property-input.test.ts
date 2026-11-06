import { expect, test } from 'vite-plus/test'
import { arrays, boolean, constant, integers, record, tuples } from './generation.js'
import { propertyInput } from './property-input.js'

test('fixed data defaults to one evaluation while generated domains default to exploration', () => {
  expect(propertyInput(tuples())).toMatchObject({ classification: 'fixed', runs: 1, seed: undefined })
  expect(propertyInput(tuples(record({ id: constant('user'), values: constant([1, 2]) })))).toMatchObject({
    classification: 'fixed',
    runs: 1,
  })
  expect(propertyInput(tuples(arrays(boolean())))).toMatchObject({
    classification: 'generated',
    runs: 100,
    maxShrinks: 1000,
  })
  expect(propertyInput(tuples(constant(1)), { seed: -3, runs: 5, maxShrinks: 0 })).toMatchObject({
    seed: -3,
    runs: 5,
    maxShrinks: 0,
  })
})

test('rejects vacuous exploration and non-tuple input definitions', () => {
  const source = tuples(integers())
  expect(() => propertyInput(source, { runs: 0 })).toThrow('runs')
  expect(() => propertyInput(source, { runs: 1.5 })).toThrow('runs')
  expect(() => propertyInput(source, { maxShrinks: -1 })).toThrow('maxShrinks')
  expect(() => propertyInput(source, { seed: Infinity })).toThrow('seed')
  expect(() => propertyInput(integers())).toThrow('tuples')
  expect(() => propertyInput(arrays(integers()))).toThrow('tuples')
})
