import { expect, test } from 'vite-plus/test'
import {
  countFenceLines,
  directoryOf,
  findCodeBlocks,
  findLinks,
  findMalformedRows,
  findRelativeImports,
  headings,
  isCodeLanguage,
  parseMarker,
  relativeFrom,
  resolvePath,
  slug,
  sourceLine,
  splitLines,
  stripCodeSpans,
} from './markdown.ts'

test.each([
  ['Getting Started', 'getting-started'],
  ['API: `test()`', 'api-test'],
  ['日本語の見出し', '日本語の見出し'],
  ['ユビキタス言語 — 用語', 'ユビキタス言語-—-用語'],
  ['Mock & Spy', 'mock--spy'],
  ['_private_ value', '_private_-value'],
  ['Node.js', 'nodejs'],
  ['CLI (v2)', 'cli-v2'],
  ['  leading space', '--leading-space'],
  ['タブ\tあり', 'タブあり'],
  ['Émigré Heading', 'émigré-heading'],
])('slug drops only ASCII punctuation: %s', (heading, expected) => {
  expect(slug(heading)).toBe(expected)
})

test.each([
  ['# title\n## second\n', ['title', 'second']],
  ['#no space\n### third\n', ['third']],
  ['text\n#\n# \n', []],
  ['```ts\n# inside code\n```\n', ['inside code']],
  ['## trailing carriage\r\n', ['trailing carriage\r']],
])('headings include every line starting with hashes: %j', (text, expected) => {
  expect(headings(text)).toStrictEqual(expected)
})

test.each([
  ['```ts\ncode\n```\n', 2],
  ['```ts\ncode\n', 1],
  ['``` \n```\n', 2],
  ['  ```ts\n  ```\n', 0],
])('fence lines are lines starting with backticks: %j', (text, expected) => {
  expect(countFenceLines(splitLines(text))).toBe(expected)
})

test('code blocks record the info string and the fence positions', () => {
  const lines = splitLines('intro\n```ts\na\n```\n```text\nb\n```\n```tsx title="x"\nc\n')
  expect(findCodeBlocks(lines)).toStrictEqual([
    { info: 'ts', open: 1, close: 3 },
    { info: 'text', open: 4, close: 6 },
    { info: 'tsx title="x"', open: 7, close: -1 },
  ])
})

test.each([
  ['ts', true],
  ['typescript', true],
  ['tsx', true],
  ['tsx title="x"', true],
  ['text', false],
  ['json', false],
  ['', false],
  ['tsv', false],
])('only TypeScript fences need markers: %s', (info, expected) => {
  expect(isCodeLanguage(info)).toBe(expected)
})

test('links are found with their line numbers', () => {
  const text = 'see [a](docs/a.md)\n\n[b](https://example.com) [c](#anchor) []()\n[d](docs/b.md#top)\n'
  expect(findLinks(text)).toStrictEqual([
    { link: 'docs/a.md', line: 1 },
    { link: 'https://example.com', line: 3 },
    { link: '#anchor', line: 3 },
    { link: 'docs/b.md#top', line: 4 },
  ])
})

test('code spans are removed without shifting line numbers', () => {
  expect(stripCodeSpans('a\n```ts\n| x |\n```\nb\n')).toBe('a\n\n\n\nb\n')
  expect(stripCodeSpans('| a | ```x``` |\n')).toBe('| a |  |\n')
})

test.each([
  ['| a | b |\n| --- | --- |\n| 1 | 2 |\n', []],
  ['| a | b |\n| --- | --- |\n| 1 |\n', ['| 1 |']],
  ['| a | b |\n\n| 1 |\n', []],
  ['| a \\| b | c |\n| --- | --- |\n', []],
  ['```text\n| a | b |\n| 1 |\n```\n', []],
])('table widths are compared per block: %j', (text, expected) => {
  expect(findMalformedRows(text).map((row) => row.row)).toStrictEqual(expected)
})

test('a malformed row reports the line it appears on', () => {
  expect(findMalformedRows('intro\n\n| a | b |\n| --- | --- |\n| 1 |\n')).toStrictEqual([{ row: '| 1 |', line: 5 }])
})

test.each([
  [
    '<!-- example: docs/examples/x.test.ts -->',
    { kind: 'example', target: 'docs/examples/x.test.ts', region: undefined },
  ],
  [
    '  <!-- example: docs/examples/x.test.ts#mock-basics -->  ',
    { kind: 'example', target: 'docs/examples/x.test.ts', region: 'mock-basics' },
  ],
  ['<!-- example: none — CLI の出力例 -->', { kind: 'none', reason: 'CLI の出力例' }],
  ['<!-- example: none - CLI の出力例 -->', { kind: 'none', reason: 'CLI の出力例' }],
  ['<!-- example: none -->', { kind: 'invalid', reason: 'none marker needs a reason' }],
  ['<!-- example: none — -->', { kind: 'invalid', reason: 'none marker needs a reason' }],
  ['<!-- example: -->', { kind: 'invalid', reason: 'marker has no example reference' }],
  ['<!-- example: docs/examples/x.test.ts# -->', { kind: 'invalid', reason: 'marker has an empty region name' }],
  ['<!-- example: #region -->', { kind: 'invalid', reason: 'marker has no example path' }],
])('markers are parsed from the comment line: %s', (line, expected) => {
  expect(parseMarker(line)).toStrictEqual(expected)
})

test.each(['plain text', '<!-- prettier-ignore -->', '<!-- example: docs/a.ts', 'example: docs/a.ts'])(
  'non-marker lines are not markers: %s',
  (line) => {
    expect(parseMarker(line)).toBeUndefined()
  },
)

test.each([
  ['README.md', 'docs/examples/x.test.ts', '出典: [docs/examples/x.test.ts](docs/examples/x.test.ts)'],
  ['docs/api-mock.md', 'docs/examples/x.test.ts', '出典: [docs/examples/x.test.ts](examples/x.test.ts)'],
  ['docs/api-test.md', 'docs/spec/type-errors.ts', '出典: [docs/spec/type-errors.ts](spec/type-errors.ts)'],
])('source lines link relative to the document: %s', (document, target, expected) => {
  expect(sourceLine(document, target)).toBe(expected)
})

test.each([
  ['', 'docs/examples/x.ts', 'docs/examples/x.ts'],
  ['docs', 'docs/examples/x.ts', 'examples/x.ts'],
  ['docs/examples', 'docs/spec/x.ts', '../spec/x.ts'],
  ['docs/examples', 'README.md', '../../README.md'],
])('relative links climb out of the document directory: %s', (directory, target, expected) => {
  expect(relativeFrom(directory, target)).toBe(expected)
})

test.each([
  ['docs', 'examples/x.ts', 'docs/examples/x.ts'],
  ['docs', './examples/x.ts', 'docs/examples/x.ts'],
  ['docs', '../README.md', 'README.md'],
  ['docs/examples', '../../src/index.ts', 'src/index.ts'],
  ['', 'docs/examples/x.ts', 'docs/examples/x.ts'],
  ['docs', 'examples/', 'docs/examples'],
  ['docs', '..', '.'],
])('paths normalize inside the repository: %s %s', (base, relative, expected) => {
  expect(resolvePath(base, relative)).toBe(expected)
})

test.each([
  ['docs', '../../secret'],
  ['', '../secret'],
  ['docs', '/etc/passwd'],
  ['docs', '../..'],
])('paths that escape the repository are rejected: %s %s', (base, relative) => {
  expect(resolvePath(base, relative)).toBeUndefined()
})

test.each([
  ['README.md', ''],
  ['docs/a.md', 'docs'],
  ['docs/examples/a.ts', 'docs/examples'],
])('directories are taken from the path: %s', (path, expected) => {
  expect(directoryOf(path)).toBe(expected)
})

test('relative import specifiers are collected', () => {
  const text = [
    "import { calc } from './calc.ts'",
    'import type { User } from "../spec/user.ts"',
    "import 'hanamaru'",
    "const lazy = await import('./data.ts')",
    "const label = 'not a path'",
  ].join('\n')
  expect(findRelativeImports(text)).toStrictEqual(['./calc.ts', '../spec/user.ts', './data.ts'])
})
