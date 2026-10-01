import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, onTestFinished, test } from 'vite-plus/test'
import { invoke, objectValue, property } from '../../foundation/value.js'
import { createModuleCompiler } from './compiler.js'
import { ModuleRegistry } from './reference.js'
import { createModuleRuntime } from './runtime.js'

const entryURL = new URL('../../index.ts', import.meta.url)

/** 書き換えて読み直す場面があるため、fixtureは1件ごとに別のdirectoryへ置く。 */
function workspace() {
  const directory = mkdtempSync(join(tmpdir(), 'hanamaru-modules-'))
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }))
  return {
    write(name: string, source: string) {
      const file = join(directory, name)
      writeFileSync(file, source)
      return { file, url: pathToFileURL(file).href }
    },
  }
}

async function compiler() {
  const created = await createModuleCompiler(entryURL)
  onTestFinished(() => created.close())
  return created
}

test('a module keeps one namespace per runtime and separate runtimes keep separate state', async () => {
  const { url } = workspace().write('counter.ts', 'let count = 0\nexport function next() {\n  return ++count\n}\n')
  const { invoke: fetch } = await compiler()
  const left = createModuleRuntime(new ModuleRegistry(), fetch)
  const right = createModuleRuntime(new ModuleRegistry(), fetch)
  onTestFinished(() => left.close())
  onTestFinished(() => right.close())
  const first = await left.import(url)
  expect(await left.import(url)).toBe(first)
  const second = await right.import(url)
  expect(second).not.toBe(first)
  expect(invoke(objectValue(first.next), undefined, [])).toBe(1)
  expect(invoke(objectValue(first.next), undefined, [])).toBe(2)
  expect(invoke(objectValue(second.next), undefined, [])).toBe(1)
})

test('the namespace of a module is registered in the registry that built it', async () => {
  const { file, url } = workspace().write('value.ts', 'export const value = 1\n')
  const registry = new ModuleRegistry()
  const runtime = createModuleRuntime(registry, (await compiler()).invoke)
  onTestFinished(() => runtime.close())
  // 台帳の見出しはViteが解決したmodule idで、import時のURLではない。準備の照合もこの見出しに従う。
  expect(registry.identify(await runtime.import(url))).toBe(file)
})

test('the compiler answers builtins, rejects unknown requests and keeps fetched code per instance', async () => {
  const space = workspace()
  const { url } = space.write('fetched.ts', 'export const value = 1\n')
  const first = await compiler()
  expect(await first.invoke('getBuiltins', [])).toContain('fs')
  await expect(first.invoke('unexpected', [])).rejects.toThrow('unknown module request: unexpected')
  const before = await first.invoke('fetchModule', [url, undefined, {}])
  space.write('fetched.ts', 'export const value = 2\n')
  expect(await first.invoke('fetchModule', [url, undefined, {}])).toStrictEqual(before)
  expect(await (await compiler()).invoke('fetchModule', [url, undefined, {}])).not.toStrictEqual(before)
})

test('a prepared mock replaces the export for saved references and restores it', async () => {
  const { file, url } = workspace().write('answer.ts', 'export function answer() {\n  return 1\n}\n')
  const runtime = createModuleRuntime(new ModuleRegistry(), (await compiler()).invoke, [{ id: file, keys: ['answer'] }])
  onTestFinished(() => runtime.close())
  const namespace = await runtime.import(url)
  const saved = objectValue(namespace.answer)
  const binding = runtime.bindCall({ object: namespace, key: 'answer' })
  expect(binding.sourceObject).toBe(namespace)
  const original = property(binding.object, binding.key)
  expect(Reflect.set(binding.object, binding.key, () => 99)).toBe(true)
  expect(invoke(saved, undefined, [])).toBe(99)
  expect(Reflect.set(binding.object, binding.key, original)).toBe(true)
  expect(invoke(saved, undefined, [])).toBe(1)
})

test('binding a key that was not prepared is refused', async () => {
  const { url } = workspace().write('plain.ts', 'export function answer() {\n  return 1\n}\n')
  const runtime = createModuleRuntime(new ModuleRegistry(), (await compiler()).invoke)
  onTestFinished(() => runtime.close())
  const namespace = await runtime.import(url)
  expect(() => runtime.bindCall({ object: namespace, key: 'answer' })).toThrow('unprepared module mock')
})

test('a missing named export is reported with the importing module url', async () => {
  const space = workspace()
  space.write('source.ts', 'export const present = 1\n')
  const { url } = space.write('importer.ts', "import { missing } from './source.ts'\nexport const seen = missing\n")
  const runtime = createModuleRuntime(new ModuleRegistry(), (await compiler()).invoke)
  onTestFinished(() => runtime.close())
  await expect(runtime.import(url)).rejects.toThrow("does not provide an export named 'missing'")
})

test('a cyclic import sees the same namespace object as the finished import', async () => {
  const space = workspace()
  space.write('second.ts', "import * as first from './first.ts'\nexport const seen = first\n")
  const { url } = space.write('first.ts', "import { seen } from './second.ts'\nexport const self = seen\n")
  const runtime = createModuleRuntime(new ModuleRegistry(), (await compiler()).invoke)
  onTestFinished(() => runtime.close())
  const namespace = await runtime.import(url)
  expect(namespace.self).toBe(namespace)
})

test('importing a file that does not exist rejects', async () => {
  const url = `${workspace().write('present.ts', 'export const value = 1\n').url}.missing.ts`
  const runtime = createModuleRuntime(new ModuleRegistry(), (await compiler()).invoke)
  onTestFinished(() => runtime.close())
  await expect(runtime.import(url)).rejects.toThrow()
})
