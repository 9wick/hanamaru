import test from 'node:test'
import assert from 'node:assert/strict'
import { parse } from 'valibot'
import {
  cliMessageSchema,
  executionMessageSchema,
  executionIncomingSchema,
  executionWorkerDataSchema,
} from '../src/schemas.ts'

test('worker boundaries reject malformed input and mismatched payload fields', () => {
  const invalid = [
    [executionIncomingSchema, { type: 'attempt', id: '1', path: [0], number: 1 }],
    [executionIncomingSchema, { type: 'attempt', id: 1, path: ['0'], number: 1 }],
    [executionIncomingSchema, { type: 'group-close', id: 1, path: [0] }],
    [executionIncomingSchema, { type: 'other' }],
    [executionWorkerDataSchema, { roots: [], preparation: [], shape: [] }],
    [executionMessageSchema, { type: 'reply', id: 1, value: { result: {}, retryable: true } }],
    [
      cliMessageSchema,
      { type: 'result', reporter: 'json', result: { version: 1, status: 'passed', reason: 'completed', tests: [{}] } },
    ],
    [cliMessageSchema, { type: 'deadline', kind: 'start', timeoutMs: 1 }],
    [cliMessageSchema, { type: 'loading', file: 'a.ts', timeout: '100' }],
  ]
  for (const [schema, input] of invalid) assert.throws(() => parse(schema, input))
})

test('validated worker messages preserve commands, deadlines, and nested results', () => {
  const command = { type: 'group-close', id: 1, path: [0, 2], failed: false }
  assert.deepEqual(parse(executionIncomingSchema, command), command)
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
    assert.deepEqual(parse(cliMessageSchema, message), message)
})
