import * as v from 'valibot'
import { required, property } from './value.js'
import { cliWorkerDataSchema, configSchema } from './schemas.js'
import type { Value } from './value.js'
import type { Config } from './api.js'
import type { CliMessage, RootReference, InternalRunOptions } from './internal.js'
import type { MutableRunResult, Plan } from './internal.js'
import { errorStack } from './shared.js'
import { parentPort, workerData as rawWorkerData } from 'node:worker_threads'
import { globSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfigFromFile } from '@hanamaru/vite'
import { startDefinitionTracking, unregisteredDefinitions } from './definition.js'
import { registrationsIn, resetRegistrations } from './registration.js'
import { collectBlueprints, createPlan, runPlan } from './runner.js'
import { describeExecutionPlan } from './execution-plan.js'
import { collectModulePreparation } from './module-reference.js'
import { openExecution } from './execution-client.js'
import { positive } from './shared.js'
import { createModuleCompiler } from './module-compiler.js'
import { createModuleRuntime } from './module-runtime.js'

if (!parentPort) throw new Error('collection requires a worker thread')
const port = parentPort
const workerData = v.parse(cliWorkerDataSchema, rawWorkerData)
const consoleMethods: ('log' | 'info' | 'warn' | 'error' | 'debug')[] = ['log', 'info', 'warn', 'error', 'debug']
for (const method of consoleMethods)
  console[method] = (...values: Value[]) => process.stderr.write(values.map(String).join(' ') + '\n')
function send(value: CliMessage) {
  port.postMessage(value)
}
const controller = new AbortController()
port.on('message', (message) => {
  if (property(message, 'type') === 'interrupt') controller.abort()
})
let compiler: Awaited<ReturnType<typeof createModuleCompiler>> | undefined
let runtime: ReturnType<typeof createModuleRuntime> | undefined
function importFile(file: string, timeout: number) {
  send({ type: 'loading', file, timeout })
  return required(runtime).import(pathToFileURL(file).href)
}
interface SelectedFile {
  file: string
  projects: string[]
}
function selectFiles(config: Config): SelectedFile[] {
  if (workerData.files.length)
    return [...new Set(workerData.files.map((file) => resolve(file)))].sort().map((file) => ({ file, projects: [] }))
  if (config.projects) {
    const selected = new Map<string, SelectedFile>()
    const names = [...new Set(workerData.options.projects ?? Object.keys(config.projects))]
    for (const name of names) {
      if (!Object.hasOwn(config.projects, name)) throw new TypeError(`unknown project: ${name}`)
      const { include, exclude = [] } = config.projects[name]
      const excluded = new Set(
        exclude.flatMap((pattern) => [...globSync(pattern, { cwd: process.cwd() })].map((file) => resolve(file))),
      )
      for (const pattern of include) {
        for (const match of globSync(pattern, { cwd: process.cwd() })) {
          const file = resolve(match)
          if (excluded.has(file)) continue
          const entry = selected.get(file) ?? { file, projects: [] }
          if (!entry.projects.includes(name)) entry.projects.push(name)
          selected.set(file, entry)
        }
      }
    }
    return [...selected.values()].sort((a, b) => a.file.localeCompare(b.file))
  }
  if (workerData.options.projects?.length) throw new TypeError(`unknown project: ${workerData.options.projects[0]}`)
  const include = ['**/*.{test,spec}.ts']
  const exclude = ['**/node_modules/**', '**/dist/**']
  const files = new Set(include.flatMap((pattern) => [...globSync(pattern, { cwd: process.cwd() })]))
  for (const pattern of exclude) for (const file of globSync(pattern, { cwd: process.cwd() })) files.delete(file)
  return [...files]
    .map((file) => resolve(file))
    .sort()
    .map((file) => ({ file, projects: [] }))
}
async function collectAndRun() {
  let collectingFile: SelectedFile | undefined
  try {
    const initialTimeout = workerData.options.collectionTimeout ?? 30_000
    positive(initialTimeout, 'collectionTimeout')
    const foundConfigs = [...globSync('hanamaru.config.{ts,js,mts,mjs}', { cwd: process.cwd() })].sort()
    const configPath = resolve(workerData.options.config ?? foundConfigs[0] ?? 'hanamaru.config.ts')
    let config: Config = {}
    if (workerData.options.config || foundConfigs.length) {
      send({ type: 'loading', file: configPath, timeout: initialTimeout })
      const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, configPath, process.cwd(), 'silent')
      if (!loaded) throw new Error(`cannot load config: ${configPath}`)
      if (Object.hasOwn(loaded.config, 'include') || Object.hasOwn(loaded.config, 'exclude'))
        throw new TypeError('include and exclude must be configured in projects')
      const viteConfig = property(loaded.config, 'vite')
      if (
        viteConfig !== undefined &&
        (viteConfig === null || typeof viteConfig !== 'object' || Array.isArray(viteConfig))
      )
        throw new TypeError('vite must be a config object')
      config = v.parse(configSchema, loaded.config)
    }
    const timeout = workerData.options.collectionTimeout ?? config.collectionTimeout ?? 30_000
    const shutdownGrace = workerData.options.shutdownGrace ?? config.shutdownGrace ?? 1_000
    positive(timeout, 'collectionTimeout')
    positive(shutdownGrace, 'shutdownGrace')
    const reporter = workerData.options.reporter ?? config.reporter ?? 'pretty'
    if (reporter !== 'pretty' && reporter !== 'json') throw new TypeError('reporter must be pretty or json')
    const files = selectFiles(config)
    if (!files.length) throw new TypeError('no test files matched')
    send({ type: 'loading', file: 'test runtime setup', timeout })
    compiler = await createModuleCompiler(config.vite)
    runtime = createModuleRuntime(compiler.invoke)
    resetRegistrations()
    startDefinitionTracking()
    const definitions: Value[] = [],
      roots: RootReference[] = [],
      sources: { file: string; projects: string[] }[] = [],
      collected = new Set<object>()
    for (const { file, projects } of files) {
      collectingFile = { file, projects }
      await importFile(file, timeout)
      const registered = registrationsIn(file)
      if (!registered.length)
        throw new TypeError(
          `no tests registered in ${relative(process.cwd(), file)}${projects.length ? ` (projects: ${projects.join(', ')})` : ''}`,
        )
      for (const [index, entry] of registered.entries()) {
        const definition = entry.definition
        if (collected.has(definition))
          throw new TypeError(
            `duplicate root definition: ${relative(process.cwd(), file)}:${entry.origin.line}${projects.length ? ` (projects: ${projects.join(', ')})` : ''}`,
          )
        collected.add(definition)
        definitions.push(definition)
        roots.push({ file, index, origin: entry.origin })
        sources.push({ file: relative(process.cwd(), file), projects })
      }
    }
    collectingFile = undefined
    for (const origin of unregisteredDefinitions(new Set(files.map(({ file }) => file)), collected))
      process.stderr.write(
        `hanamaru: unregistered test definition: ${relative(process.cwd(), origin.file)}:${origin.line}:${origin.column}\n`,
      )
    let plan: Plan
    const withSources = (result: MutableRunResult): MutableRunResult => ({
      ...result,
      tests: result.tests.map((node) => ({
        ...node,
        source: sources[plan.allNodes[node.path[0]].rootIndex],
      })),
    })
    const options: InternalRunOptions = {
      forbidOnly: workerData.options.ci,
      failOnFlaky: workerData.options.failOnFlaky,
      filter: workerData.options.filter,
      signal: controller.signal,
      onProgress: (result) => send({ type: 'progress', result: withSources(result) }),
      onTimeout: (result) => send({ type: 'timeout', result: withSources(result) }),
      onDeadline: (deadline) =>
        send({
          type: 'deadline',
          ...deadline,
          ...(deadline.kind === 'start' ? { result: withSources(deadline.result) } : {}),
        }),
    }
    const blueprints = collectBlueprints(definitions)
    plan = createPlan(blueprints, options)
    const execution = await openExecution({
      roots,
      preparation: collectModulePreparation(blueprints),
      shape: JSON.stringify(describeExecutionPlan(plan.allNodes)),
      invoke: compiler.invoke,
      signal: controller.signal,
      onLoading: (file) => send({ type: 'loading', file, timeout }),
    })
    send({ type: 'running', reporter, shutdownGrace })
    let result
    try {
      result = await runPlan(plan, options, execution)
    } finally {
      await execution.close()
    }
    send({ type: 'result', result: withSources(result), reporter })
  } catch (error) {
    const context = collectingFile
      ? `while collecting ${relative(process.cwd(), collectingFile.file)}${collectingFile.projects.length ? ` (projects: ${collectingFile.projects.join(', ')})` : ''}: `
      : ''
    send({ type: 'error', message: context + errorStack(error) })
  } finally {
    await runtime?.close()
    await compiler?.close()
  }
}
collectAndRun().catch((error) => send({ type: 'error', message: errorStack(error) }))
