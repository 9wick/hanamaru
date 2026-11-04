import { expect, test } from 'vite-plus/test'
import { diagnostic } from './diagnostic.js'
import { diagnosticRecord } from './diagnostic-record.js'

test('combining snapshots keeps circular references local to each saved graph', () => {
  const first: { self?: object } = {},
    second: { self?: object } = {}
  first.self = first
  second.self = second
  const result = diagnosticRecord([
    ['first', diagnostic(first)],
    ['second', diagnostic(second)],
    ['absent', { kind: 'missing' }],
  ])
  expect(result).toMatchObject({
    kind: 'object',
    id: 1,
    properties: [
      { value: { kind: 'object', id: 2, properties: [{ value: { kind: 'reference', id: 2 } }] } },
      { value: { kind: 'object', id: 3, properties: [{ value: { kind: 'reference', id: 3 } }] } },
      { value: { kind: 'missing' } },
    ],
  })
})
