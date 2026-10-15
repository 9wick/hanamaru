import { parse } from 'valibot'
import { expect, test } from 'vite-plus/test'
import { executionIncomingSchema, executionMessageSchema, executionWorkerDataSchema } from './schemas.js'

test('worker boundaries reject malformed input and mismatched payload fields', () => {
  const invalid = [
    () => parse(executionIncomingSchema, { type: 'attempt', id: '1', path: [0], number: 1 }),
    () => parse(executionIncomingSchema, { type: 'attempt', id: 1, path: ['0'], number: 1 }),
    () => parse(executionIncomingSchema, { type: 'group-close', id: 1, path: [0] }),
    () => parse(executionIncomingSchema, { type: 'other' }),
    () => parse(executionIncomingSchema, { type: 'initialize' }),
    () => parse(executionIncomingSchema, { type: 'initialize', spec: { roots: [], preparation: [], shape: [] } }),
    () => parse(executionWorkerDataSchema, { roots: [], preparation: [], shape: [] }),
    () => parse(executionMessageSchema, { type: 'reply', id: 1, value: { result: {}, retryable: true } }),
  ]
  for (const attempt of invalid) expect(attempt).toThrow()
})

test('validated worker messages preserve commands and initialization data', () => {
  const command = { type: 'group-close', id: 1, path: [0, 2], failed: false }
  expect(parse(executionIncomingSchema, command)).toEqual(command)
  const initialization = { type: 'initialize', spec: { roots: [], preparation: [], shape: '[]' } }
  expect(parse(executionIncomingSchema, initialization)).toEqual(initialization)
})
