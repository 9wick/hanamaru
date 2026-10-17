import { expect, test } from 'vite-plus/test'
import { diagnostic } from './diagnostic.js'

test('native errors and their causes retain stack frames', () => {
  const cause = new TypeError('inner')
  const result = diagnostic(new Error('outer', { cause }))
  expect.assert(result.kind === 'object')
  const stack = result.properties.find((property) => property.key.kind === 'string' && property.key.value === 'stack')
  expect.assert(stack?.value.kind === 'string')
  expect(stack.value.value).toContain('diagnostic.test.ts:')
  const inner = result.properties.find((property) => property.key.kind === 'string' && property.key.value === 'cause')
  expect.assert(inner?.value.kind === 'object')
  const innerStack = inner.value.properties.find(
    (property) => property.key.kind === 'string' && property.key.value === 'stack',
  )
  expect.assert(innerStack?.value.kind === 'string')
  expect(innerStack.value.value).toContain('TypeError: inner')
})

test('stack capture never invokes user-defined stack or error-name getters', () => {
  let reads = 0
  for (const key of ['stack', 'name', 'message']) {
    const error = new Error('original')
    Object.defineProperty(error, key, {
      get() {
        reads++
        throw new Error('getter invoked')
      },
    })
    expect(diagnostic(error)).toMatchObject({ kind: 'object' })
  }
  expect(reads).toBe(0)
})

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
