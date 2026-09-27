import test from 'node:test'
import assert from 'node:assert/strict'
import { ESLint } from 'eslint'

const eslint = new ESLint()
const syntaxFile = 'test/fixtures/lint-sample.ts'
const implementationFile = 'src/value.ts'
const messages = async (code, filePath = syntaxFile) => (await eslint.lintText(code, { filePath }))[0].messages

test('lint rejects type escapes in every TypeScript file', async () => {
  const forbidden = [
    ['export let input: unknown', 'no-restricted-syntax'],
    ['export let input: any', '@typescript-eslint/no-explicit-any'],
    ['export const value = 1 as number', 'no-restricted-syntax'],
    ['export const value = { x: 1 } as const', 'no-restricted-syntax'],
    ['export const value = <number>1', 'no-restricted-syntax'],
    ['export const value = [1].pop()!', '@typescript-eslint/no-non-null-assertion'],
    ['export function accepts(input: object): input is Date { return input instanceof Date }', 'no-restricted-syntax'],
    ['export function accepts(input: object): asserts input is Date {}', 'no-restricted-syntax'],
    ['export let callback: Function', '@typescript-eslint/no-unsafe-function-type'],
  ]
  for (const [code, ruleId] of forbidden) {
    assert.equal(
      (await messages(code)).some((m) => m.ruleId === ruleId && m.severity === 2),
      true,
      code,
    )
  }
})

test('lint rejects unsafe values from dependencies and native APIs', async () => {
  const found = await messages(
    "export const data = JSON.parse('{}'); data.method(data.key); export function read() { return data }",
    implementationFile,
  )
  for (const ruleId of ['no-unsafe-assignment', 'no-unsafe-call', 'no-unsafe-member-access', 'no-unsafe-return']) {
    assert.equal(
      found.some((m) => m.ruleId === `@typescript-eslint/${ruleId}`),
      true,
      ruleId,
    )
  }
  const argument = await messages(
    "function needsString(input: string) { return input }; needsString(JSON.parse('{}'))",
    implementationFile,
  )
  assert.equal(
    argument.some((m) => m.ruleId === '@typescript-eslint/no-unsafe-argument'),
    true,
  )
})

test('lint rejects promises without error handling', async () => {
  assert.equal(
    (await messages('Promise.resolve(1)', implementationFile)).some(
      (m) => m.ruleId === '@typescript-eslint/no-floating-promises',
    ),
    true,
  )
  assert.equal(
    (await messages('setTimeout(async () => 1, 10)', implementationFile)).some(
      (m) => m.ruleId === '@typescript-eslint/no-misused-promises',
    ),
    true,
  )
})

test('lint cannot be bypassed with suppression comments in implementation files', async () => {
  const ignored = await messages(
    '// eslint-disable-next-line no-restricted-syntax\nexport let input: unknown',
    implementationFile,
  )
  assert.equal(
    ignored.some((m) => m.ruleId === 'no-restricted-syntax'),
    true,
  )
  for (const comment of ['ts-ignore', 'ts-nocheck', 'ts-expect-error']) {
    assert.equal(
      (await messages(`// @${comment}\nexport const value: number = 1`, implementationFile)).some(
        (m) => m.ruleId === '@typescript-eslint/ban-ts-comment',
      ),
      true,
    )
  }
})

test('lint accepts checked inputs and described negative type tests', async () => {
  assert.deepEqual(
    await messages(
      'export function read(input: object | string): string { return typeof input === "string" ? input : "object" }',
      implementationFile,
    ),
    [],
  )
  assert.deepEqual(
    await messages(
      '// @ts-expect-error a string cannot be assigned to a number.\nexport const value: number = "bad"',
      'docs/spec/lint-sample.ts',
    ),
    [],
  )
  assert.equal(
    (await messages('// @ts-expect-error\nexport const value: number = "bad"', 'docs/spec/lint-sample.ts')).some(
      (m) => m.ruleId === '@typescript-eslint/ban-ts-comment',
    ),
    true,
  )
})
