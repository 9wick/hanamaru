import { beforeAll, expect, test } from 'vite-plus/test'
import { ESLint } from 'eslint'

// lintText replaces a virtual file repeatedly; CI single-run programs read the disk version.
const eslint = new ESLint({
  overrideConfig: [
    {
      files: ['src/**/*.ts'],
      languageOptions: { parserOptions: { disallowAutomaticSingleRunInference: true } },
    },
  ],
})
// 型情報付きルールの対象外に置くため、tsconfigのincludeに入らないパスを使う。
const syntaxFile = 'virtual/lint-sample.ts'
const implementationFile = 'src/foundation/value.ts'
const messages = async (code: string, filePath: string = syntaxFile) =>
  (await eslint.lintText(code, { filePath }))[0].messages

// 型情報付きlintの初回はTypeScriptプロジェクト全体を読み込むため、初期化をテスト本体から分離する。
beforeAll(async () => {
  expect(await messages('export const value = 1', implementationFile)).toStrictEqual([])
}, 30_000)

test('lint rejects type escapes in every TypeScript file', async () => {
  const forbidden = [
    ['export let input: any', '@typescript-eslint/no-explicit-any'],
    ['export const value = 1 as number', 'no-restricted-syntax'],
    ['export const value = { x: 1 } as const as { x: number }', 'no-restricted-syntax'],
    ['export const value = <number>1', 'no-restricted-syntax'],
    ['export const value = [1].pop()!', '@typescript-eslint/no-non-null-assertion'],
    ['export function accepts(input: object): input is Date { return input instanceof Date }', 'no-restricted-syntax'],
    ['export function accepts(input: object): asserts input is Date {}', 'no-restricted-syntax'],
    ['export let callback: Function', '@typescript-eslint/no-unsafe-function-type'],
  ]
  for (const filePath of [syntaxFile, implementationFile]) {
    for (const [code, ruleId] of forbidden) {
      expect(
        (await messages(code, filePath)).some((m) => m.ruleId === ruleId && m.severity === 2),
        `${filePath}: ${code}`,
      ).toBe(true)
    }
  }
})

test('lint accepts narrowed unknown inputs and const assertions that preserve literal types', async () => {
  const allowed = [
    'export function accepts(input: unknown) { return typeof input === "string" ? input.length : 0 }',
    'export const value = "ready" as const',
    'export const value = { x: 1 } as const',
    'export const value = ["ready", 1] as const',
    'export const value = { states: ["ready", "done"], options: { enabled: true } } as const',
  ]
  for (const filePath of [syntaxFile, implementationFile]) {
    for (const code of allowed) {
      expect(await messages(code, filePath), `${filePath}: ${code}`).toStrictEqual([])
    }
  }
})

test('lint rejects unsafe values from dependencies and native APIs', async () => {
  const found = await messages(
    "export const data = JSON.parse('{}'); data.method(data.key); export function read() { return data }",
    implementationFile,
  )
  for (const ruleId of ['no-unsafe-assignment', 'no-unsafe-call', 'no-unsafe-member-access', 'no-unsafe-return']) {
    expect(
      found.some((m) => m.ruleId === `@typescript-eslint/${ruleId}`),
      ruleId,
    ).toBe(true)
  }
  const argument = await messages(
    "function needsString(input: string) { return input }; needsString(JSON.parse('{}'))",
    implementationFile,
  )
  expect(argument.some((m) => m.ruleId === '@typescript-eslint/no-unsafe-argument')).toBe(true)
})

test('lint rejects promises without error handling', async () => {
  expect(
    (await messages('Promise.resolve(1)', implementationFile)).some(
      (m) => m.ruleId === '@typescript-eslint/no-floating-promises',
    ),
  ).toBe(true)
  expect(
    (await messages('setTimeout(async () => 1, 10)', implementationFile)).some(
      (m) => m.ruleId === '@typescript-eslint/no-misused-promises',
    ),
  ).toBe(true)
})

test('lint cannot be bypassed with suppression comments in implementation files', async () => {
  const ignored = await messages(
    '// eslint-disable-next-line @typescript-eslint/no-explicit-any\nexport let input: any',
    implementationFile,
  )
  expect(ignored.some((m) => m.ruleId === '@typescript-eslint/no-explicit-any')).toBe(true)
  for (const comment of ['ts-ignore', 'ts-nocheck', 'ts-expect-error']) {
    expect(
      (await messages(`// @${comment}\nexport const value: number = 1`, implementationFile)).some(
        (m) => m.ruleId === '@typescript-eslint/ban-ts-comment',
      ),
      comment,
    ).toBe(true)
  }
})

test('lint rejects ts-expect-error in documentation examples outside type tests', async () => {
  const diagnostics = await messages(
    '// @ts-expect-error a string cannot be assigned to a number.\nexport const value: number = "bad"',
    'docs/examples/math.ts',
  )
  expect(diagnostics.some((m) => m.ruleId === '@typescript-eslint/ban-ts-comment' && m.severity === 2)).toBe(true)
})

test('lint accepts checked inputs and described negative type tests', async () => {
  expect(
    await messages(
      'export function read(input: object | string): string { return typeof input === "string" ? input : "object" }',
      implementationFile,
    ),
  ).toStrictEqual([])
  expect(
    await messages(
      '// @ts-expect-error a string cannot be assigned to a number.\nexport const value: number = "bad"',
      'docs/spec/lint-sample.ts',
    ),
  ).toStrictEqual([])
  expect(
    (await messages('// @ts-expect-error\nexport const value: number = "bad"', 'docs/spec/lint-sample.ts')).some(
      (m) => m.ruleId === '@typescript-eslint/ban-ts-comment',
    ),
  ).toBe(true)
})

// 依存ルールの契約: 通常・再export・動的import・型参照すべてで外向きの依存を拒否する。
test('layer boundaries reject outward dependencies and entrypoint shortcuts', async () => {
  const filename = new URL('./src/domain/definition/validation.ts', import.meta.url).pathname
  for (const source of [
    "import { runCommand } from '../../interfaces/cli/command.js'; export { runCommand }",
    "export * from '../../infrastructure/comparison.js'",
    "export const runtime = import('../../infrastructure/comparison.js')",
    "export type Options = import('../../application/collection/options.js').CliOptions",
    "export * from '../../index.js'",
    "export * from '../definition/../../infrastructure/comparison.js'",
    "import { readFileSync } from 'node:fs'; export { readFileSync }",
  ]) {
    expect(
      (await messages(source, filename)).some((message) => message.ruleId === 'architecture/dependencies'),
      source,
    ).toBe(true)
  }
})

test('layer boundaries accept inward dependencies', async () => {
  const cases = [
    ['src/interfaces/library/run.ts', "export * from '../../application/execution/options.js'"],
    ['src/application/execution/runner.ts', "export * from '../../domain/result/types.js'"],
    ['src/infrastructure/workers/client.ts', "export * from '../../application/ports/executor.js'"],
    ['src/domain/result/diagnostic.ts', "export * from '../../foundation/value.js'"],
  ]
  for (const [file, source] of cases) {
    expect(
      (await messages(source, new URL(file, import.meta.url).pathname)).filter(
        (message) => message.ruleId === 'architecture/dependencies',
      ),
      file,
    ).toEqual([])
  }
})
