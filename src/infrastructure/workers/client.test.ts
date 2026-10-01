import { expect, test } from 'vite-plus/test'
import { RequestTable } from './client.js'

test('requests are numbered in order and settled by their own id', async () => {
  const table = new RequestTable()
  const posted: number[] = []
  const first = table.open((id) => posted.push(id))
  const second = table.open((id) => posted.push(id))
  expect(posted).toStrictEqual([0, 1])
  table.settle(1, { entered: true })
  table.settle(0, { middleware: { status: 'passed', durationMs: 0, cleanup: 'complete', failures: [] }, reason: null })
  expect(await second).toStrictEqual({ entered: true })
  expect(await first).toMatchObject({ reason: null })
})

test('a settled request is forgotten and no longer waiting', () => {
  const table = new RequestTable()
  void table.open(() => {})
  expect(table.has(0)).toBe(true)
  table.settle(0, { entered: true })
  expect(table.has(0)).toBe(false)
  expect(table.has(5)).toBe(false)
  expect(() => table.settle(0, { entered: true })).toThrow(/no request is waiting/)
})

test('abandoning the table rejects everything still waiting', async () => {
  const table = new RequestTable()
  const first = table.open(() => {})
  const second = table.open(() => {})
  table.abandon(new Error('execution worker exited (1)'))
  await expect(first).rejects.toThrow(/execution worker exited \(1\)/)
  await expect(second).rejects.toThrow(/execution worker exited \(1\)/)
  expect(table.has(0)).toBe(false)
})
