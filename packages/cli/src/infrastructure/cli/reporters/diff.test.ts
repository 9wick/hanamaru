import { expect, test } from 'vite-plus/test'
import { diagnostic } from '../../../../../runner/src/domain/result/diagnostic.js'
import { formatDiff } from './diff.js'

test('partial comparisons point at nested array differences without unrelated actual properties', () => {
  const expected = { evidence: [{ targets: ['repo', 'user'] }] }
  const actual = { nodes: [{ name: 'irrelevant' }], evidence: [{ targets: ['user', 'repo'], extra: true }] }
  expect(formatDiff(diagnostic(expected), diagnostic(actual), 'partial')).toEqual([
    'evidence[0].targets[0]',
    '- expected: "repo"',
    '+ actual:   "user"',
    'evidence[0].targets[1]',
    '- expected: "user"',
    '+ actual:   "repo"',
  ])
})

test('equal comparisons show missing and extra properties but respect undefined equality', () => {
  expect(formatDiff(diagnostic({ removed: 1, unused: undefined }), diagnostic({ added: 2 }), 'equal')).toEqual([
    'removed',
    '- expected: 1',
    '+ actual:   <missing>',
    'added',
    '- expected: <missing>',
    '+ actual:   2',
  ])
  expect(formatDiff(diagnostic({ required: undefined }), diagnostic({}), 'partial')).toEqual([
    'required',
    '- expected: undefined',
    '+ actual:   <missing>',
  ])
})

test('paths escape property names and preserve array lengths and sparse-array semantics', () => {
  expect(formatDiff(diagnostic({ 'a.b': [1, 2] }), diagnostic({ 'a.b': [1] }), 'equal')).toEqual([
    '["a.b"][1]',
    '- expected: 2',
    '+ actual:   <missing>',
  ])
  const sparse = [1, 2]
  Reflect.deleteProperty(sparse, 1)
  expect(formatDiff(diagnostic(sparse), diagnostic([1, undefined]), 'equal')).toEqual([])
})

test('opaque values and references keep the existing full-value diagnostic', () => {
  expect(formatDiff(diagnostic(new Set([1, 2])), diagnostic(new Set([2, 3])), 'equal')).toEqual([])
  const shared = { value: 1 }
  expect(formatDiff(diagnostic([shared, shared]), diagnostic([{ value: 1 }, { value: 2 }]), 'equal')).toEqual([])
})

test('partial comparisons do not claim regexp differences that the matcher does not constrain', () => {
  expect(formatDiff(diagnostic({ pattern: /a/, count: 1 }), diagnostic({ pattern: /b/, count: 2 }), 'partial')).toEqual(
    [],
  )
})

test('large differences are bounded with explicit notice', () => {
  const output = formatDiff(diagnostic(Array(30).fill(1)), diagnostic(Array(30).fill(2)), 'equal')
  expect(output).toHaveLength(61)
  expect(output.at(-1)).toBe('… additional differences not shown')
})
