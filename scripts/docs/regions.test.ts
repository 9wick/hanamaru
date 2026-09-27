import { expect, test } from 'vite-plus/test'
import { isRegionName, parseRegions, renderFile, renderRegion } from './regions.ts'

function render(text: string, name: string): string {
  const parse = parseRegions(text)
  const region = parse.regions.get(name)
  if (region === undefined) return '<missing>'
  return renderRegion(parse, region)
}

test.each([
  ['mock-basics', true],
  ['a1', true],
  ['0', true],
  ['Mock', false],
  ['mock_basics', false],
  ['mock basics', false],
  ['', false],
])('region names are lowercase words: %s', (name, expected) => {
  expect(isRegionName(name)).toBe(expected)
})

test('a region renders the lines between its markers', () => {
  const text = [
    'import { test } from "hanamaru"',
    '',
    '// #region calls',
    'const a = 1',
    '// #endregion calls',
    '',
  ].join('\n')
  expect(render(text, 'calls')).toBe('const a = 1')
})

test('nested regions drop the inner markers and keep the outer body', () => {
  const text = [
    '// #region outer',
    'const a = 1',
    '  // #region inner',
    '  const b = 2',
    '  // #endregion inner',
    'const c = 3',
    '// #endregion outer',
  ].join('\n')
  expect(render(text, 'outer')).toBe('const a = 1\n  const b = 2\nconst c = 3')
  expect(render(text, 'inner')).toBe('const b = 2')
})

test('the minimum indentation is removed without counting blank lines', () => {
  const text = ['// #region body', '    const a = 1', '', '      const b = 2', '  // #endregion body'].join('\n')
  expect(render(text, 'body')).toBe('const a = 1\n\n  const b = 2')
})

test('tabs are treated as one indentation character each', () => {
  const text = ['// #region body', '\t\tconst a = 1', '\t\t\tconst b = 2', '// #endregion body'].join('\n')
  expect(render(text, 'body')).toBe('const a = 1\n\tconst b = 2')
})

test('blank lines around the body are trimmed and CRLF becomes LF', () => {
  const text = ['// #region body', '', 'const a = 1', '   ', '// #endregion body'].join('\r\n')
  expect(render(text, 'body')).toBe('const a = 1')
})

test('a whole file renders without markers and without surrounding blank lines', () => {
  const text = ['', '// #region body', 'const a = 1', '// #endregion body', 'const b = 2', '', ''].join('\n')
  expect(renderFile(parseRegions(text))).toBe('const a = 1\nconst b = 2')
})

test.each([
  ['// #region body\nconst a = 1\n', [{ kind: 'unclosed-region', name: 'body', line: 1 }]],
  [
    '// #region body\nconst a = 1\n// #endregion other\n',
    [
      { kind: 'mismatched-endregion', name: 'other', line: 3 },
      { kind: 'unclosed-region', name: 'body', line: 1 },
    ],
  ],
  ['// #endregion body\n', [{ kind: 'mismatched-endregion', name: 'body', line: 1 }]],
  [
    '// #region body\nconst a = 1\n// #endregion body\n// #region body\nconst b = 2\n// #endregion body\n',
    [{ kind: 'duplicate-region', name: 'body', line: 4 }],
  ],
  ['// #region Body\nconst a = 1\n// #endregion Body\n', [{ kind: 'invalid-region-name', name: 'Body', line: 1 }]],
  ['// #region\nconst a = 1\n// #endregion\n', [{ kind: 'invalid-region-name', name: '', line: 1 }]],
  ['// #region body\n\n// #endregion body\n', [{ kind: 'empty-region', name: 'body', line: 1 }]],
])('region syntax problems are reported: %j', (text, expected) => {
  expect(parseRegions(text).issues).toStrictEqual(expected)
})

test('a duplicate name keeps the first region', () => {
  const text = [
    '// #region body',
    'const first = 1',
    '// #endregion body',
    '// #region body',
    'const second = 2',
    '// #endregion body',
  ].join('\n')
  expect(render(text, 'body')).toBe('const first = 1')
})

test('lines that only look like markers are left in the body', () => {
  const text = ['// #region body', '// #regionalize', 'const a = 1', '// #endregion body'].join('\n')
  expect(render(text, 'body')).toBe('// #regionalize\nconst a = 1')
})
