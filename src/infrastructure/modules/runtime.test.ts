import type { ConfigClass } from '@zeltjs/core'
import { Config, createApp } from '@zeltjs/core'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, onTestFinished, test } from 'vite-plus/test'
import type { ModulePreparation, ModuleTransport } from '../../application/ports/module-loader.js'
import { invoke, objectValue, property } from '../../foundation/value.js'
import { ModuleCompilerLauncher } from './compiler.js'
import { ModuleEntry } from './entry.js'
import { ModuleRegistry } from './reference.js'
import { ModuleRuntimeLauncher } from './runtime.js'

@Config()
class TestEntry extends ModuleEntry {
  override readonly url = new URL('../../index.ts', import.meta.url)
}

/** 1つのscopeにつき1つのtest runtime。別のscopeは評価状態もmockの台帳も共有しない。 */
async function scope(configs: ConfigClass<object>[] = []) {
  const created = await createApp([]).createRuntime({ configs: [TestEntry, ...configs] })
  onTestFinished(() => created.shutdown())
  return created
}

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

/** 開いた持ち場は使い終わりに畳む。開けなかったrunには畳む相手がない。 */
async function compiler() {
  const created = await (await (await scope()).get(ModuleCompilerLauncher)).start()
  onTestFinished(() => created.close())
  return created
}

/** 実行workerと同じ組み立て。差し替える宛先はruntimeを組み立てるときに決まる。 */
async function runtime(transport: ModuleTransport, preparation: ModulePreparation[] = []) {
  const created = (await (await scope()).get(ModuleRuntimeLauncher)).start(transport, preparation)
  onTestFinished(() => created.close())
  return created
}

test('a module keeps one namespace per runtime and separate runtimes keep separate state', async () => {
  const { url } = workspace().write('counter.ts', 'let count = 0\nexport function next() {\n  return ++count\n}\n')
  const transport = await compiler()
  const left = await runtime(transport)
  const right = await runtime(transport)
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
  const transport = await compiler()
  const open = await scope()
  const registry = await open.get(ModuleRegistry)
  const loaded = (await open.get(ModuleRuntimeLauncher)).start(transport, [])
  onTestFinished(() => loaded.close())
  // 台帳の見出しはViteが解決したmodule idで、import時のURLではない。準備の照合もこの見出しに従う。
  expect(registry.identify(await loaded.import(url))).toBe(file)
  expect(registry.identify(await loaded.import(file))).toBe(file)
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
  const loaded = await runtime(await compiler(), [{ id: file, keys: ['answer'] }])
  const namespace = await loaded.import(url)
  const saved = objectValue(namespace.answer)
  const binding = loaded.bindCall({ object: namespace, key: 'answer' })
  expect(binding.sourceObject).toBe(namespace)
  const original = property(binding.object, binding.key)
  expect(Reflect.set(binding.object, binding.key, () => 99)).toBe(true)
  expect(invoke(saved, undefined, [])).toBe(99)
  expect(Reflect.set(binding.object, binding.key, original)).toBe(true)
  expect(invoke(saved, undefined, [])).toBe(1)
})

test('binding a key that was not prepared is refused', async () => {
  const { url } = workspace().write('plain.ts', 'export function answer() {\n  return 1\n}\n')
  const loaded = await runtime(await compiler())
  const namespace = await loaded.import(url)
  expect(() => loaded.bindCall({ object: namespace, key: 'answer' })).toThrow('unprepared module mock')
})

test('a missing named export is reported with the importing module url', async () => {
  const space = workspace()
  space.write('source.ts', 'export const present = 1\n')
  const { url } = space.write('importer.ts', "import { missing } from './source.ts'\nexport const seen = missing\n")
  const loaded = await runtime(await compiler())
  await expect(loaded.import(url)).rejects.toThrow("does not provide an export named 'missing'")
})

test('a cyclic import sees the same namespace object as the finished import', async () => {
  const space = workspace()
  space.write('second.ts', "import * as first from './first.ts'\nexport const seen = first\n")
  const { url } = space.write('first.ts', "import { seen } from './second.ts'\nexport const self = seen\n")
  const loaded = await runtime(await compiler())
  const namespace = await loaded.import(url)
  expect(namespace.self).toBe(namespace)
})

test('importing a file that does not exist rejects', async () => {
  const url = `${workspace().write('present.ts', 'export const value = 1\n').url}.missing.ts`
  const loaded = await runtime(await compiler())
  await expect(loaded.import(url)).rejects.toThrow()
})

test('closing twice keeps one shutdown and refuses later work', async () => {
  const { url } = workspace().write('closing.ts', 'export const value = 1\n')
  const transport = await compiler()
  const loaded = await runtime(transport)
  await loaded.import(url)
  const closingRuntime = loaded.close()
  expect(loaded.close()).toBe(closingRuntime)
  await closingRuntime
  const closingCompiler = transport.close()
  expect(transport.close()).toBe(closingCompiler)
  await closingCompiler
  await expect(loaded.import(url)).rejects.toThrow('module runtime is closed')
  await expect(transport.invoke('getBuiltins', [])).rejects.toThrow('module compiler is closed')
})
