import * as v from 'valibot'
import { expect, test } from 'vite-plus/test'
import { executionIncomingSchema, executionMessageSchema, transportValueSchema } from './schemas.js'

// 契約: 通信値は実装参照を含まないデータ。送信前と受信後で同じ形を検証できる。
test('commands and replies survive structured cloning with the same data', () => {
  const command = { type: 'attempt', id: 1, path: [0, 2], number: 3, resourceFields: { seed: 7 } }
  expect(v.parse(executionIncomingSchema, structuredClone(command))).toEqual(command)
  const reply = {
    type: 'reply',
    id: 1,
    value: {
      result: {
        attempt: 3,
        status: 'passed',
        durationMs: 1,
        outcome: null,
        assertions: [],
        failures: [],
        cleanup: 'complete',
      },
      retryable: false,
    },
  }
  expect(v.parse(executionMessageSchema, structuredClone(reply))).toEqual(reply)
})

test('transport data rejects functions, symbols and class instances at every depth', () => {
  for (const value of [() => 1, Symbol('ref'), new Date(), new Map(), { nested: [() => 1] }])
    expect(v.safeParse(transportValueSchema, value).success).toBe(false)
  const value = { code: 'export const value = 1', values: [null, undefined, true, 4n] }
  expect(v.parse(transportValueSchema, structuredClone(value))).toEqual(value)
})
