import { createTestTarget } from '@zeltjs/testing/vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, onTestFinished, test } from 'vite-plus/test'
import { TsconfigResolver } from './resolver.js'

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'hanamaru-resolver-'))
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true })
  })
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), { recursive: true })
    writeFileSync(join(root, name), source)
  }
  return root
}

function from(root: string, file: string): string {
  return pathToFileURL(join(root, file)).href
}

test('aliases resolve through the TypeScript extension candidates', async () => {
  const root = project({
    'tsconfig.json': `{
      // trailing commas and comments are part of the accepted tsconfig dialect
      "compilerOptions": { "baseUrl": ".", "paths": { "@app/*": ["src/*"], "shared": ["lib/shared.ts"] } },
    }`,
    'src/thing.ts': 'export const thing = 1',
    'src/folder/index.ts': 'export const folder = 1',
    'lib/shared.ts': 'export const shared = 1',
    'caller.js': '',
  })
  const { target: resolver } = await createTestTarget(TsconfigResolver)
  const caller = from(root, 'caller.js')
  expect(resolver.resolve('@app/thing.js', caller)).toBe(join(root, 'src/thing.ts'))
  expect(resolver.resolve('@app/thing', caller)).toBe(join(root, 'src/thing.ts'))
  expect(resolver.resolve('@app/folder', caller)).toBe(join(root, 'src/folder/index.ts'))
  expect(resolver.resolve('shared', caller)).toBe(join(root, 'lib/shared.ts'))
  expect(resolver.resolve('@app/absent', caller)).toBeNull()
  expect(resolver.resolve('node:fs', caller)).toBeNull()
})

test('specifiers outside a file URL have no tsconfig to consult', async () => {
  const { target: resolver } = await createTestTarget(TsconfigResolver)
  expect(resolver.resolve('@app/thing', 'data:text/javascript,')).toBeNull()
})

test('the nearest tsconfig wins over the one above it', async () => {
  const root = project({
    'tsconfig.json': '{ "compilerOptions": { "paths": { "@app/*": ["outer/*"] } } }',
    'outer/thing.ts': 'export const thing = 1',
    'inner/thing.ts': 'export const thing = 2',
    'inner/tsconfig.json': '{ "compilerOptions": { "paths": { "@app/*": ["*"] } } }',
    'inner/caller.js': '',
  })
  const { target: resolver } = await createTestTarget(TsconfigResolver)
  expect(resolver.resolve('@app/thing', from(root, 'inner/caller.js'))).toBe(join(root, 'inner/thing.ts'))
  expect(resolver.resolve('@app/thing', from(root, 'caller.js'))).toBe(join(root, 'outer/thing.ts'))
})

test('one resolver reads a tsconfig once, a new one reads it again', async () => {
  const root = project({
    'tsconfig.json': '{ "compilerOptions": { "paths": { "@app/*": ["first/*"] } } }',
    'first/thing.ts': 'export const thing = 1',
    'second/thing.ts': 'export const thing = 2',
    'caller.js': '',
  })
  const { target: resolver } = await createTestTarget(TsconfigResolver)
  expect(resolver.resolve('@app/thing', from(root, 'caller.js'))).toBe(join(root, 'first/thing.ts'))
  writeFileSync(join(root, 'tsconfig.json'), '{ "compilerOptions": { "paths": { "@app/*": ["second/*"] } } }')
  expect(resolver.resolve('@app/thing', from(root, 'caller.js'))).toBe(join(root, 'first/thing.ts'))
  const { target: freshResolver } = await createTestTarget(TsconfigResolver)
  expect(freshResolver.resolve('@app/thing', from(root, 'caller.js'))).toBe(join(root, 'second/thing.ts'))
})

test('a directory without any tsconfig stays unresolved', async () => {
  const root = project({ 'caller.js': '' })
  const { target: resolver } = await createTestTarget(TsconfigResolver)
  expect(resolver.resolve('@app/thing', from(root, 'caller.js'))).toBeNull()
})
