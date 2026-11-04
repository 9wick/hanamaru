import { expect, test } from 'vite-plus/test'
import { captureValue } from '@hanamaru/blueprint/model'
import { imageDiagnostic } from './image-diagnostic.js'

test('diagnostics retain captured public data and cycles without running getters', () => {
  let reads = 0
  const value: { name: string; self?: object; readonly computed: string } = {
    name: 'before',
    get computed() {
      reads++
      return 'computed'
    },
  }
  value.self = value
  const image = captureValue(value)
  value.name = 'after'
  expect(imageDiagnostic(image)).toEqual({
    kind: 'object',
    id: 1,
    type: 'Object',
    omitted: [],
    properties: [
      { key: { kind: 'string', value: 'name' }, value: { kind: 'string', value: 'before' } },
      { key: { kind: 'string', value: 'computed' }, value: { kind: 'accessor', get: true, set: false } },
      { key: { kind: 'string', value: 'self' }, value: { kind: 'reference', id: 1 } },
    ],
  })
  expect(reads).toBe(0)
})

test('diagnostics represent map values, sparse arrays and dates at capture time', () => {
  const array: number[] = []
  array.length = 2
  array[1] = 3
  const date = new Date('2020-01-01T00:00:00Z')
  const map = new Map<string, object>([
    ['array', array],
    ['date', date],
  ])
  const image = captureValue(map)
  array[1] = 9
  date.setFullYear(2025)
  map.clear()
  expect(imageDiagnostic(image)).toEqual({
    kind: 'map',
    id: 1,
    entries: [
      [
        { kind: 'string', value: 'array' },
        { kind: 'array', id: 2, items: [{ kind: 'hole' }, { kind: 'number', value: 3 }], properties: [] },
      ],
      [
        { kind: 'string', value: 'date' },
        { kind: 'date', id: 3, value: '2020-01-01T00:00:00.000Z' },
      ],
    ],
  })
})

test('functions and bytes use distinct graph ids while repeated functions retain their identity', () => {
  const fn = () => 1
  const result = imageDiagnostic(captureValue({ fn, same: fn, buffer: new ArrayBuffer(2) }))
  expect.assert(result.kind === 'object')
  const first = result.properties[0].value
  const repeated = result.properties[1].value
  const buffer = result.properties[2].value
  expect.assert(first.kind === 'function' && repeated.kind === 'reference' && buffer.kind === 'object')
  expect(repeated.id).toBe(first.id)
  expect(first.id).not.toBe(result.id)
  const bytes = buffer.properties.find(
    (property) => property.key.kind === 'string' && property.key.value === 'bytes',
  )?.value
  expect.assert(bytes?.kind === 'array')
  expect(new Set([result.id, first.id, buffer.id, bytes.id]).size).toBe(4)
})

test('symbol keys and values use one identity registry', () => {
  const first = Symbol('same'),
    second = Symbol('same')
  const result = imageDiagnostic(captureValue({ [first]: second, [second]: first }))
  expect.assert(result.kind === 'object')
  const a = result.properties[0],
    b = result.properties[1]
  expect.assert(
    a.key.kind === 'symbol' && b.key.kind === 'symbol' && a.value.kind === 'symbol' && b.value.kind === 'symbol',
  )
  expect(a.key.id).toBe(b.value.id)
  expect(b.key.id).toBe(a.value.id)
  expect(a.key.id).not.toBe(b.key.id)
})

test('inspection failures cannot leave dangling references or throw out of diagnostics', () => {
  const prototype = new Proxy(
    {},
    {
      getOwnPropertyDescriptor() {
        throw new Error('uninspectable prototype')
      },
    },
  )
  const shared = { value: 1 }
  Object.setPrototypeOf(shared, prototype)
  const result = imageDiagnostic(captureValue([shared, shared]))
  expect.assert(result.kind === 'array')
  expect(result.items.map((item) => item.kind)).toEqual(['omitted', 'omitted'])
})
