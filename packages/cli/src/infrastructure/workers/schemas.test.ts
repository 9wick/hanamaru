import { parse } from 'valibot'
import { expect, test } from 'vite-plus/test'
import { cliMessageSchema } from './schemas.js'

test('worker boundaries reject malformed input and mismatched payload fields', () => {
  const invalid = [
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
    { type: 'deadline', kind: 'start', timeoutMs: 100, progress: { kind: 'init', result } },
    { type: 'deadline', kind: 'end' },
    { type: 'progress', progress: { kind: 'init', result } },
    { type: 'error', message: 'failure' },
  ])
    expect(parse(cliMessageSchema, message)).toStrictEqual(message)
})
