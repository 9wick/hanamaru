import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, test } from 'vite-plus/test'
import { run } from './docs.ts'

const calc = ['export function add(first: number, second: number) {', '  return first + second', '}', '']
const sample = [
  "import { test } from 'hanamaru'",
  "import { add } from './calc.ts'",
  '',
  'export const addition = test(add).args(1, 2).expect(3)',
  '',
]
const sampleBody = sample.slice(0, -1)
const regions = [
  "import { test } from 'hanamaru'",
  '',
  '// #region mock-basics',
  'export const mocked = test(add).args(1).expect(1)',
  '// #endregion mock-basics',
  '',
]
const spec = [
  '// #region bad-args',
  '// @ts-expect-error 引数の型が違う',
  'const wrong: number = "1"',
  '// #endregion bad-args',
  '',
]

function documents(): Record<string, string> {
  const readme = [
    '# Sample',
    '',
    '導入の説明。',
    '',
    '<!-- example: docs/examples/sample.test.ts -->',
    '```ts',
    ...sampleBody,
    '```',
    '出典: [docs/examples/sample.test.ts](docs/examples/sample.test.ts)',
    '',
    '詳細は [ガイド](docs/a.md#見出し) を参照。',
    '',
    '| 列 | 説明 |',
    '| --- | --- |',
    '| a | b |',
    '',
  ]
  const guide = [
    '# 見出し',
    '',
    '<!-- example: docs/examples/regions.ts#mock-basics -->',
    '```ts',
    'export const mocked = test(add).args(1).expect(1)',
    '```',
    '出典: [docs/examples/regions.ts](examples/regions.ts)',
    '',
    '<!-- example: docs/spec/errors.ts#bad-args -->',
    '```ts',
    '// @ts-expect-error 引数の型が違う',
    'const wrong: number = "1"',
    '```',
    '出典: [docs/spec/errors.ts](spec/errors.ts)',
    '',
    '<!-- example: none — CLI の出力例 -->',
    '```ts',
    'run()',
    '```',
    '',
    '[README](../README.md#sample) に戻る。',
    '',
  ]
  return {
    'README.md': readme.join('\n'),
    'docs/a.md': guide.join('\n'),
    'docs/examples/calc.ts': calc.join('\n'),
    'docs/examples/sample.test.ts': sample.join('\n'),
    'docs/examples/regions.ts': regions.join('\n'),
    'docs/spec/errors.ts': spec.join('\n'),
  }
}

async function tree(files: Record<string, string>): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'hanamaru-docs-')))
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }
  return root
}

async function checkTree(files: Record<string, string>, argv: readonly string[] = []) {
  const root = await tree(files)
  try {
    return await run(argv, { cwd: root })
  } finally {
    // 失敗時も一時ディレクトリを残さない。
    await rm(root, { recursive: true, force: true })
  }
}

function lineOf(text: string, needle: string): number {
  return text.slice(0, text.indexOf(needle)).split('\n').length
}

test('a consistent corpus passes', async () => {
  const result = await checkTree(documents())
  expect(result.lines).toStrictEqual([
    '2 documents; 5 local links; 2 anchors; 3 linked examples; 1 negative type assertions',
    'errors: 0',
  ])
  expect(result.code).toBe(0)
})

test('an edited example is reported, fixed by --write and then stable', async () => {
  const files = documents()
  files['docs/examples/sample.test.ts'] = sample.join('\n').replace('args(1, 2)', 'args(2, 3)')
  const root = await tree(files)
  const before = await run([], { cwd: root })
  expect(before.code).toBe(1)
  expect(before.lines).toContain(
    `README.md:${lineOf(files['README.md'], '```ts')}: code block is out of sync with docs/examples/sample.test.ts (npm run docs:sync)`,
  )

  const written = await run(['--write'], { cwd: root })
  expect(written.code).toBe(0)
  expect(written.lines).toContain('updated README.md')
  expect(await readFile(join(root, 'README.md'), 'utf8')).toContain('test(add).args(2, 3).expect(3)')

  const after = await run([], { cwd: root })
  expect(after.code).toBe(0)
  const again = await run(['--write'], { cwd: root })
  expect(again.lines.filter((line) => line.startsWith('updated '))).toStrictEqual([])
  await rm(root, { recursive: true, force: true })
})

test('a code block without a marker is rejected', async () => {
  const files = documents()
  files['README.md'] = files['README.md'].replace('<!-- example: docs/examples/sample.test.ts -->\n', '')
  const result = await checkTree(files)
  expect(result.code).toBe(1)
  expect(result.lines).toContain(
    `README.md:${lineOf(files['README.md'], '```ts')}: code block needs a marker: <!-- example: docs/examples/x.test.ts#region --> or <!-- example: none — reason -->`,
  )
})

test('a none marker without a reason is rejected', async () => {
  const files = documents()
  files['docs/a.md'] = files['docs/a.md'].replace('none — CLI の出力例', 'none')
  const result = await checkTree(files)
  expect(result.code).toBe(1)
  expect(result.lines).toContain(
    `docs/a.md:${lineOf(files['docs/a.md'], '<!-- example: none -->')}: invalid example marker: none marker needs a reason`,
  )
})

test('a none block must not carry a source line', async () => {
  const files = documents()
  files['docs/a.md'] = files['docs/a.md'].replace(
    'run()\n```\n',
    'run()\n```\n出典: [docs/examples/calc.ts](examples/calc.ts)\n',
  )
  const result = await checkTree(files)
  expect(result.code).toBe(1)
  expect(result.lines.some((line) => line.includes('none block must not have a source line'))).toBe(true)
})

test('a marker that points at a missing region or file is rejected', async () => {
  const files = documents()
  files['docs/a.md'] = files['docs/a.md'].replace('regions.ts#mock-basics', 'regions.ts#mock-extras')
  const missingRegion = await checkTree(files)
  expect(missingRegion.lines).toContain(
    `docs/a.md:${lineOf(files['docs/a.md'], '<!-- example: docs/examples/regions.ts')}: missing region #mock-extras in docs/examples/regions.ts`,
  )

  const other = documents()
  other['docs/a.md'] = other['docs/a.md'].replace('docs/examples/regions.ts#mock-basics', 'docs/examples/gone.ts')
  const missingFile = await checkTree(other)
  expect(missingFile.lines.some((line) => line.includes('missing example docs/examples/gone.ts'))).toBe(true)
})

test.each([
  ['docs/examples/../../../etc/passwd', 'example path must stay inside docs/examples/ or docs/spec/'],
  ['src/index.ts', 'example path must stay inside docs/examples/ or docs/spec/'],
  ['docs/examples/./regions.ts', 'example path must stay inside docs/examples/ or docs/spec/'],
])('a marker path outside the example roots is rejected: %s', async (target, message) => {
  const files = documents()
  files['docs/a.md'] = files['docs/a.md'].replace('docs/examples/regions.ts#mock-basics', target)
  const result = await checkTree(files)
  expect(result.code).toBe(1)
  expect(result.lines.some((line) => line.includes(message))).toBe(true)
})

test('an unclosed region is reported', async () => {
  const files = documents()
  files['docs/examples/regions.ts'] = regions.join('\n').replace('// #endregion mock-basics\n', '')
  const result = await checkTree(files)
  expect(result.code).toBe(1)
  expect(result.lines).toContain('docs/examples/regions.ts:3: unclosed region mock-basics')
})

test('a duplicate region name is reported', async () => {
  const files = documents()
  files['docs/examples/regions.ts'] = [...regions, ...regions.slice(2, 5), ''].join('\n')
  const result = await checkTree(files)
  expect(result.code).toBe(1)
  expect(result.lines.some((line) => line.includes('duplicate region mock-basics'))).toBe(true)
})

test('a region that no document references is reported', async () => {
  const files = documents()
  files['docs/examples/sample.test.ts'] = [
    ...sample.slice(0, -1),
    '// #region extra',
    'export const extra = test(add).args(0).expect(0)',
    '// #endregion extra',
    '',
  ].join('\n')
  const result = await checkTree(files, ['--write'])
  expect(result.lines.some((line) => line.includes('region extra is not used by any document'))).toBe(true)
})

test('an unused example file is reported while an imported helper is not', async () => {
  const files = documents()
  files['docs/examples/lonely.ts'] = 'export const lonely = 1\n'
  const result = await checkTree(files)
  expect(result.code).toBe(1)
  expect(result.lines).toContain(
    'docs/examples/lonely.ts:1: example file is not used by any document and not imported by another example',
  )
  expect(result.lines.some((line) => line.startsWith('docs/examples/calc.ts'))).toBe(false)
})

test('example bodies stay checked and synced without adding visible source lines', async () => {
  const files = documents()
  for (const path of ['README.md', 'docs/a.md']) {
    files[path] = files[path].replace(/^出典: .*\n/gm, '')
  }
  const root = await tree(files)
  try {
    expect((await run([], { cwd: root })).code).toBe(0)
    const stable = await run(['--write'], { cwd: root })
    expect(stable.code).toBe(0)
    expect(stable.lines.filter((line) => line.startsWith('updated '))).toStrictEqual([])
    await writeFile(join(root, 'docs/examples/sample.test.ts'), sample.join('\n').replace('args(1, 2)', 'args(2, 3)'))
    const changed = await run([], { cwd: root })
    expect(changed.code).toBe(1)
    expect(changed.lines.some((line) => line.includes('code block is out of sync'))).toBe(true)
    expect((await run(['--write'], { cwd: root })).code).toBe(0)
    const synced = await readFile(join(root, 'README.md'), 'utf8')
    expect(synced).toContain('test(add).args(2, 3).expect(3)')
    expect(synced).not.toContain('出典:')
    expect((await run([], { cwd: root })).code).toBe(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an existing incorrect source line is reported and repaired', async () => {
  const files = documents()
  const original = '出典: [docs/examples/sample.test.ts](docs/examples/sample.test.ts)\n'
  files['README.md'] = files['README.md'].replace(original, '出典: [docs/examples/calc.ts](docs/examples/calc.ts)\n')
  const root = await tree(files)
  const before = await run([], { cwd: root })
  expect(before.code).toBe(1)
  expect(before.lines.some((line) => line.includes('source line is out of sync'))).toBe(true)
  expect((await run(['--write'], { cwd: root })).code).toBe(0)
  expect(await readFile(join(root, 'README.md'), 'utf8')).toContain(original)
  expect((await run([], { cwd: root })).code).toBe(0)
  await rm(root, { recursive: true, force: true })
})

test('the legacy markdown checks still run', async () => {
  const files = documents()
  files['README.md'] = files['README.md']
    .replace('[ガイド](docs/a.md#見出し)', '[ガイド](docs/missing.md) [節](docs/a.md#no-such-anchor)')
    .replace('| a | b |', '| a | b | c |')
  files['docs/a.md'] = `${files['docs/a.md']}\n\`\`\`text\nunclosed\n`
  const result = await checkTree(files)
  expect(result.code).toBe(1)
  const messages = result.lines.map((line) => line.replace(/^[^:]+:\d+: /, ''))
  expect(messages).toContain('missing docs/missing.md')
  expect(messages).toContain('missing anchor docs/a.md#no-such-anchor')
  expect(messages).toContain('malformed table: | a | b | c |')
  expect(messages).toContain('unbalanced code fences')
})

test('nested documents remain subject to links, example sync, and marker checks', async () => {
  const files = documents()
  files['docs/guides/nested.md'] = [
    '# Nested',
    '[missing](missing.md)',
    '',
    '<!-- example: docs/examples/sample.test.ts -->',
    '```ts',
    'outOfDate()',
    '```',
    '出典: [docs/examples/sample.test.ts](../examples/sample.test.ts)',
    '',
    '```ts',
    'missingMarker()',
    '```',
    '',
  ].join('\n')
  const root = await tree(files)
  try {
    const checked = await run([], { cwd: root })
    expect(checked.code).toBe(1)
    expect(checked.lines.join('\n')).toContain('docs/guides/nested.md:')
    expect(checked.lines.join('\n')).toContain('missing missing.md')
    expect(checked.lines.join('\n')).toContain('code block is out of sync')
    expect(checked.lines.join('\n')).toContain('code block needs a marker')
    await run(['--write'], { cwd: root })
    const synced = await readFile(join(root, 'docs/guides/nested.md'), 'utf8')
    expect(synced).toContain(sampleBody.join('\n'))
    expect(synced).toContain('](../examples/sample.test.ts)')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
