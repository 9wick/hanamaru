import { expect, test } from 'vite-plus/test'
import { collectWithin, recordCollectionEvent } from './current-scope.js'
import { createCollectionScope } from './scope.js'

const consumed = (definition: object) => ({ kind: 'consumed', definition }) as const

async function rejection(act: () => Promise<unknown>): Promise<string> {
  try {
    await act()
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : 'a non-Error value was thrown'
  }
  return 'nothing was thrown'
}

test('events are recorded while the scope is open and ignored once it is closed', async () => {
  const scope = createCollectionScope()
  const inside = {}
  const outside = {}
  const result = await collectWithin(scope, async () => {
    recordCollectionEvent(consumed(inside))
    return 'loaded'
  })
  recordCollectionEvent(consumed(outside))
  expect(result).toBe('loaded')
  expect(scope.events).toEqual([consumed(inside)])
})

test('the scope is closed when the load throws and when it rejects', async () => {
  const thrower = createCollectionScope()
  expect(
    await rejection(() =>
      collectWithin(thrower, () => {
        throw new TypeError('import failed')
      }),
    ),
  ).toBe('TypeError: import failed')
  const rejecter = createCollectionScope()
  expect(await rejection(() => collectWithin(rejecter, () => Promise.reject(new TypeError('load failed'))))).toBe(
    'TypeError: load failed',
  )
  const reopened = createCollectionScope()
  await collectWithin(reopened, async () => recordCollectionEvent(consumed(reopened)))
  expect(reopened.events).toHaveLength(1)
})

test('opening a second scope throws and leaves the open one recording', async () => {
  const outer = createCollectionScope()
  const inner = createCollectionScope()
  const counts = { loads: 0 }
  const definition = {}
  await collectWithin(outer, async () => {
    expect(
      await rejection(() =>
        collectWithin(inner, async () => {
          counts.loads++
        }),
      ),
    ).toBe('TypeError: a collection scope is already open')
    recordCollectionEvent(consumed(definition))
  })
  expect(counts).toEqual({ loads: 0 })
  expect(inner.events).toEqual([])
  expect(outer.events).toEqual([consumed(definition)])
})
