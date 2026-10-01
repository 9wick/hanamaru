import { expect, test } from 'vite-plus/test'
import type { ReplyValue } from './protocol.js'
import { PendingReplies } from './requests.js'

test('requests are numbered in order and settled by their own id', async () => {
  const table = new PendingReplies<ReplyValue>()
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
  const table = new PendingReplies<ReplyValue>()
  void table.open(() => {})
  expect(table.has(0)).toBe(true)
  expect(table.settle(0, { entered: true })).toBe(true)
  expect(table.has(0)).toBe(false)
  expect(table.has(5)).toBe(false)
  // 覚えのない返信は見分けた結果だけを返す。どう畳むかは持ち主が決める。
  expect(table.settle(0, { entered: true })).toBe(false)
})

test('abandoning the table rejects everything still waiting', async () => {
  const table = new PendingReplies<ReplyValue>()
  const first = table.open(() => {})
  const second = table.open(() => {})
  table.abandon(new Error('execution worker exited (1)'))
  await expect(first).rejects.toThrow(/execution worker exited \(1\)/)
  await expect(second).rejects.toThrow(/execution worker exited \(1\)/)
  expect(table.has(0)).toBe(false)
})
