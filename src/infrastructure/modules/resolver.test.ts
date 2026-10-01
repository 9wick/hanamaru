import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, onTestFinished, test } from 'vite-plus/test'
import { resolveTsconfigPath } from './resolver.js'

function project(tsconfig: string, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'hanamaru-resolver-'))
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true })
  })
  writeFileSync(join(root, 'tsconfig.json'), tsconfig)
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), { recursive: true })
    writeFileSync(join(root, name), source)
  }
  return root
}

function from(root: string, file: string): string {
  return pathToFileURL(join(root, file)).href
}

test('aliases resolve through the TypeScript extension candidates', () => {
  const root = project(
    `{
      // trailing commas and comments are part of the accepted tsconfig dialect
      "compilerOptions": { "baseUrl": ".", "paths": { "@app/*": ["src/*"], "shared": ["lib/shared.ts"] } },
    }`,
    {
      'src/thing.ts': 'export const thing = 1',
      'src/folder/index.ts': 'export const folder = 1',
      'lib/shared.ts': 'export const shared = 1',
      'caller.js': '',
    },
  )
  const caller = from(root, 'caller.js')
  expect(resolveTsconfigPath('@app/thing.js', caller)).toBe(join(root, 'src/thing.ts'))
  expect(resolveTsconfigPath('@app/thing', caller)).toBe(join(root, 'src/thing.ts'))
  expect(resolveTsconfigPath('@app/folder', caller)).toBe(join(root, 'src/folder/index.ts'))
  expect(resolveTsconfigPath('shared', caller)).toBe(join(root, 'lib/shared.ts'))
  expect(resolveTsconfigPath('@app/absent', caller)).toBeNull()
  expect(resolveTsconfigPath('node:fs', caller)).toBeNull()
})

test('specifiers outside a file URL have no tsconfig to consult', () => {
  expect(resolveTsconfigPath('@app/thing', 'data:text/javascript,')).toBeNull()
})

test('the nearest tsconfig wins over the one above it', () => {
  const root = project('{ "compilerOptions": { "paths": { "@app/*": ["outer/*"] } } }', {
    'outer/thing.ts': 'export const thing = 1',
    'inner/thing.ts': 'export const thing = 2',
    'inner/tsconfig.json': '{ "compilerOptions": { "paths": { "@app/*": ["*"] } } }',
    'inner/caller.js': '',
  })
  expect(resolveTsconfigPath('@app/thing', from(root, 'inner/caller.js'))).toBe(join(root, 'inner/thing.ts'))
  expect(resolveTsconfigPath('@app/thing', from(root, 'caller.js'))).toBe(join(root, 'outer/thing.ts'))
})

test('a tsconfig is read once and later edits do not change the answer', () => {
  const root = project('{ "compilerOptions": { "paths": { "@app/*": ["first/*"] } } }', {
    'first/thing.ts': 'export const thing = 1',
    'second/thing.ts': 'export const thing = 2',
    'caller.js': '',
  })
  expect(resolveTsconfigPath('@app/thing', from(root, 'caller.js'))).toBe(join(root, 'first/thing.ts'))
  writeFileSync(join(root, 'tsconfig.json'), '{ "compilerOptions": { "paths": { "@app/*": ["second/*"] } } }')
  expect(resolveTsconfigPath('@app/thing', from(root, 'caller.js'))).toBe(join(root, 'first/thing.ts'))
})

test('a directory without any tsconfig stays unresolved', () => {
  const root = mkdtempSync(join(tmpdir(), 'hanamaru-resolver-'))
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true })
  })
  writeFileSync(join(root, 'caller.js'), '')
  expect(resolveTsconfigPath('@app/thing', from(root, 'caller.js'))).toBeNull()
})
