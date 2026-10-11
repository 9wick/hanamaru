import { expect, test } from 'vite-plus/test'
import { diagnostic } from './diagnostic.js'

test('omitted objects cannot leave references to discarded diagnostic nodes', () => {
  const cause = { detail: 'retained' }
  const broken = new Proxy(new Error('broken', { cause }), {
    ownKeys() {
      throw new Error('keys unavailable')
    },
  })
  const result = diagnostic([broken, broken, cause, cause])
  expect.assert(result.kind === 'array')
  expect(result.items[0]).toMatchObject({ kind: 'omitted' })
  expect(result.items[1]).toMatchObject({ kind: 'omitted' })
  const retained = result.items[2]
  expect.assert(retained.kind === 'object')
  expect(result.items[3]).toEqual({ kind: 'reference', id: retained.id })
})
