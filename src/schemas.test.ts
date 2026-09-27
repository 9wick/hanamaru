import { expect, test } from 'vite-plus/test'
import { parse } from 'valibot'
import {
  cliMessageSchema,
  executionMessageSchema,
  executionIncomingSchema,
  executionWorkerDataSchema,
} from './schemas.js'

test('worker boundaries reject malformed input and mismatched payload fields', () => {
  const invalid = [
    () => parse(executionIncomingSchema, { type: 'attempt', id: '1', path: [0], number: 1 }),
    () => parse(executionIncomingSchema, { type: 'attempt', id: 1, path: ['0'], number: 1 }),
    () => parse(executionIncomingSchema, { type: 'group-close', id: 1, path: [0] }),
    () => parse(executionIncomingSchema, { type: 'other' }),
    () => parse(executionWorkerDataSchema, { roots: [], preparation: [], shape: [] }),
    () => parse(executionMessageSchema, { type: 'reply', id: 1, value: { result: {}, retryable: true } }),
    () =>
      parse(cliMessageSchema, {
        type: 'result',
        reporter: 'json',
        result: { version: 1, status: 'passed', reason: 'completed', tests: [{}] },
      }),
    () => parse(cliMessageSchema, { type: 'deadline', kind: 'start', timeoutMs: 1 }),
    () => parse(cliMessageSchema, { type: 'loading', file: 'a.ts', timeout: '100' }),
  ]
  for (const [index, attempt] of invalid.entries()) expect(attempt, `invalid[${index}]`).toThrow()
})

test('validated worker messages preserve commands, deadlines, and nested results', () => {
  const command = { type: 'group-close', id: 1, path: [0, 2], failed: false }
  expect(parse(executionIncomingSchema, command)).toStrictEqual(command)
  const location = { file: 'a.ts', line: 1, column: 1 }
  const result = {
    version: 1,
    status: 'passed',
    reason: 'completed',
    tests: [
      {
        kind: 'group',
        name: null,
        path: [0],
        origin: location,
        middleware: null,
        children: [{ origin: location, result: { kind: 'test', name: 'target', path: [0, 0], cases: [] } }],
      },
    ],
  }
  for (const message of [
    { type: 'result', reporter: 'json', result },
    { type: 'deadline', kind: 'start', timeoutMs: 100, result },
    { type: 'deadline', kind: 'end' },
    { type: 'progress', result },
    { type: 'error', message: 'failure' },
  ])
    expect(parse(cliMessageSchema, message)).toStrictEqual(message)
})
