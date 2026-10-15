import { recordDeclaration as recordCollectionEvent } from '../../../../blueprint/src/application/declarations.js'
import { expect, test } from 'vite-plus/test'
import { collectWithin } from './current-scope.js'
import { CollectionLog } from './scope.js'

const file = 'a.ts'
const files = new Set([file])

/** 記録されたかどうかは、ログの問い合わせ(未登録定義)越しに見る。 */
const declared = (definition: object, line: number) =>
  ({ kind: 'declared', definition, origin: { file, line, column: 1 } }) as const

async function rejection(act: () => Promise<unknown>): Promise<string> {
  try {
    await act()
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : 'a non-Error value was thrown'
  }
  return 'nothing was thrown'
}

test('events are recorded while the scope is open and ignored once it is closed', async () => {
  const log = new CollectionLog()
  const result = await collectWithin(log, async () => {
    recordCollectionEvent(declared({}, 1))
    return 'loaded'
  })
  recordCollectionEvent(declared({}, 2))
  expect(result).toBe('loaded')
  expect(log.unregisteredDefinitions(files).map((origin) => origin.line)).toEqual([1])
})

test('the scope is closed when the load throws and when it rejects', async () => {
  const thrower = new CollectionLog()
  expect(
    await rejection(() =>
      collectWithin(thrower, () => {
        throw new TypeError('import failed')
      }),
    ),
  ).toBe('TypeError: import failed')
  const rejecter = new CollectionLog()
  expect(await rejection(() => collectWithin(rejecter, () => Promise.reject(new TypeError('load failed'))))).toBe(
    'TypeError: load failed',
  )
  const reopened = new CollectionLog()
  await collectWithin(reopened, async () => recordCollectionEvent(declared({}, 3)))
  expect(reopened.unregisteredDefinitions(files)).toHaveLength(1)
})

test('opening a second scope throws and leaves the open one recording', async () => {
  const outer = new CollectionLog()
  const inner = new CollectionLog()
  const counts = { loads: 0 }
  await collectWithin(outer, async () => {
    expect(
      await rejection(() =>
        collectWithin(inner, async () => {
          counts.loads++
        }),
      ),
    ).toBe('TypeError: a collection scope is already open')
    recordCollectionEvent(declared({}, 4))
  })
  expect(counts).toEqual({ loads: 0 })
  expect(inner.unregisteredDefinitions(files)).toEqual([])
  expect(outer.unregisteredDefinitions(files).map((origin) => origin.line)).toEqual([4])
})
