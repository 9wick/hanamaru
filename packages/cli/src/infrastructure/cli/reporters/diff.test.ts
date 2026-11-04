import { expect, test } from 'vite-plus/test'
import { diagnostic } from '../../../../../runner/src/domain/result/diagnostic.js'
import { formatDiff } from './diff.js'

test('selected comparisons include the complete path', () => {
  expect(formatDiff(diagnostic(['repo', 'user']), diagnostic(['user', 'repo']), ['evidence', 0, 'targets'])).toEqual([
    'evidence[0].targets[0]',
    '- expected: "repo"',
    '+ actual:   "user"',
    'evidence[0].targets[1]',
    '- expected: "user"',
    '+ actual:   "repo"',
  ])
})
test('missing fields and undefined remain distinct', () => {
  expect(formatDiff(diagnostic({ removed: 1, unused: undefined }), diagnostic({ added: 2 }))).toEqual([
    'removed',
    '- expected: 1',
    '+ actual:   <missing>',
    'unused',
    '- expected: undefined',
    '+ actual:   <missing>',
    'added',
    '- expected: <missing>',
    '+ actual:   2',
  ])
})
test('paths escape property names and distinguish holes from undefined', () => {
  expect(formatDiff(diagnostic({ 'a.b': [1, 2] }), diagnostic({ 'a.b': [1] }))).toEqual([
    '["a.b"][1]',
    '- expected: 2',
    '+ actual:   <missing>',
  ])
  const sparse = [1, 2]
  Reflect.deleteProperty(sparse, 1)
  const diff = formatDiff(diagnostic(sparse), diagnostic([1, undefined]))
  expect(diff[0]).toBe('[1]')
  expect(diff[2]).toBe('+ actual:   undefined')
})
test('opaque values and references retain full-value diagnostics', () => {
  expect(formatDiff(diagnostic(new Set([1, 2])), diagnostic(new Set([2, 3])))).toEqual([])
  const shared = { value: 1 }
  expect(formatDiff(diagnostic([shared, shared]), diagnostic([{ value: 1 }, { value: 2 }]))).toEqual([])
})
test('regular expressions retain their value meaning', () => {
  expect(formatDiff(diagnostic(/a/), diagnostic(/b/), ['pattern'])).toEqual([
    'pattern',
    '- expected: /a/',
    '+ actual:   /b/',
  ])
})
test('large differences are bounded with an explicit notice', () => {
  const output = formatDiff(diagnostic(Array(30).fill(1)), diagnostic(Array(30).fill(2)))
  expect(output).toHaveLength(61)
  expect(output.at(-1)).toBe('… additional differences not shown')
})
