import { expect, expectTypeOf, test } from 'vite-plus/test'
import { captureAdaptedValue, valueAdapter } from './value-adapter.js'
import type { ValueAdapter } from './value-adapter.js'
import { captureValue, equalValues } from './value-image.js'

class Money {
  #minor: number
  constructor(minor: number) {
    this.#minor = minor
  }
  minorUnits() {
    return this.#minor
  }
}

test('projects opaque values into independently saved comparison data', () => {
  const data = { minor: 120 }
  const adapter = valueAdapter(Money, (value) => {
    data.minor = value.minorUnits()
    return data
  })
  expectTypeOf(adapter).toEqualTypeOf<ValueAdapter<Money>>()
  const expected = captureValue(captureAdaptedValue(adapter, new Money(120)))
  const actual = captureValue(captureAdaptedValue(adapter, new Money(130)))
  expect(equalValues(expected, actual)).toBe(false)
  expect(equalValues(expected, captureValue({ minor: 120 }))).toBe(true)
})

test('rejects forged adapters, incompatible inputs and non-data projections', () => {
  const adapter = valueAdapter(Money, (value) => ({ minor: value.minorUnits() }))
  expect(() => captureAdaptedValue({ kind: 'value-adapter' }, new Money(1))).toThrow('valueAdapter()')
  expect(() => captureAdaptedValue(adapter, { minor: 1 })).toThrow('another type')
  expect(() =>
    captureAdaptedValue(
      valueAdapter(Money, (value) => value),
      new Money(1),
    ),
  ).toThrow('projection')
})

test('reports projection errors without turning them into equality or fallback data', () => {
  const failure = new Error('capture failed')
  const adapter = valueAdapter(Money, () => {
    throw failure
  })
  expect(() => captureAdaptedValue(adapter, new Money(1))).toThrow(failure)
})
