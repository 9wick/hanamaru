import { expect, test } from 'vite-plus/test'
import { errorStack } from './failure.js'

test('error diagnostics preserve an existing stack without duplicating its description', () => {
  const error = new TypeError('only is forbidden')
  const stack = error.stack
  expect(errorStack(error)).toBe(stack)
})

test('error diagnostics retain the original reason when the stack omits it', () => {
  const error = new TypeError('only is forbidden')
  error.stack = 'Error\n    at select (selection.ts:130:1)'
  expect(errorStack(error)).toBe('TypeError: only is forbidden\nError\n    at select (selection.ts:130:1)')
})

test('error diagnostics retain the original name and reason without a stack', () => {
  const error = new TypeError('only is forbidden')
  error.stack = undefined
  expect(errorStack(error)).toBe('TypeError: only is forbidden')
})

test('error diagnostics preserve non-Error values', () => {
  for (const value of ['failure', 0, null, undefined]) expect(errorStack(value)).toBe(String(value))
})
