import { parentPort, workerData } from 'node:worker_threads'
import { globSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfigFromFile } from '@hanamaru/vite'
import { Test, isDefinition } from './definition.js'
import { collectBlueprints, createPlan, runPlan } from './runner.js'
import { describeExecutionPlan } from './execution-plan.js'
import { collectModulePreparation } from './module-reference.js'
import { openExecution } from './execution-client.js'
import { positive } from './shared.js'
import { createModuleCompiler } from './module-compiler.js'
import { createModuleRuntime } from './module-runtime.js'

for (const method of ['log', 'info', 'warn', 'error', 'debug'])
  console[method] = (...values) => process.stderr.write(values.map(String).join(' ') + '\n')
function send(value) {
  parentPort.postMessage(value)
}
const controller = new AbortController()
parentPort.on('message', (message) => {
  if (message?.type === 'interrupt') controller.abort()
})
let compiler, runtime
function importFile(file, timeout) {
  send({ type: 'loading', file, timeout })
  return runtime.import(pathToFileURL(file).href)
}
function selectFiles(config) {
  if (workerData.files.length) return [...new Set(workerData.files.map((file) => resolve(file)))].sort()
  const include = config.include ?? ['**/*.{test,spec}.ts']
  const exclude = config.exclude ?? ['**/node_modules/**', '**/dist/**']
  const files = new Set(include.flatMap((pattern) => [...globSync(pattern, { cwd: process.cwd() })]))
  for (const pattern of exclude) for (const file of globSync(pattern, { cwd: process.cwd() })) files.delete(file)
  return [...files].map((file) => resolve(file)).sort()
}
async function collectAndRun() {
  try {
    const initialTimeout = workerData.options.collectionTimeout ?? 30_000
    positive(initialTimeout, 'collectionTimeout')
    const foundConfigs = [...globSync('hanamaru.config.{ts,js,mts,mjs}', { cwd: process.cwd() })].sort()
    const configPath = resolve(workerData.options.config ?? foundConfigs[0] ?? 'hanamaru.config.ts')
    let config = {}
    if (workerData.options.config || foundConfigs.length) {
      send({ type: 'loading', file: configPath, timeout: initialTimeout })
      const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, configPath, process.cwd(), 'silent')
      config = loaded.config
    }
    const timeout = workerData.options.collectionTimeout ?? config.collectionTimeout ?? 30_000
    const shutdownGrace = workerData.options.shutdownGrace ?? config.shutdownGrace ?? 1_000
    positive(timeout, 'collectionTimeout')
    positive(shutdownGrace, 'shutdownGrace')
    const reporter = workerData.options.reporter ?? config.reporter ?? 'pretty'
    if (!['pretty', 'json'].includes(reporter)) throw new TypeError('reporter must be pretty or json')
    const files = selectFiles(config)
    if (!files.length) throw new TypeError('no test files matched')
    send({ type: 'loading', file: 'test runtime setup', timeout })
    compiler = await createModuleCompiler(config.vite)
    runtime = createModuleRuntime(compiler.invoke)
    const definitions = [],
      roots = [],
      collected = new Set()
    for (const file of files) {
      const module = await importFile(file, timeout)
      for (const name of Object.keys(module).sort()) {
        const value = module[name]
        if (value instanceof Test && !isDefinition(value))
          throw new TypeError(`${relative(process.cwd(), file)}:${name} is an incomplete test builder`)
        if (!isDefinition(value)) continue
        if (collected.has(value))
          throw new TypeError(`duplicate root definition: ${relative(process.cwd(), file)}:${name}`)
        collected.add(value)
        definitions.push(value)
        roots.push({ file, name })
      }
    }
    if (!definitions.length) throw new TypeError('no completed test definitions found')
    const options = {
      forbidOnly: workerData.options.ci,
      failOnFlaky: workerData.options.failOnFlaky,
      filter: workerData.options.filter,
      signal: controller.signal,
      onProgress: (result) => send({ type: 'progress', result }),
      onTimeout: (result) => send({ type: 'timeout', result }),
      onDeadline: (deadline) => send({ type: 'deadline', ...deadline }),
    }
    const blueprints = collectBlueprints(definitions)
    const plan = createPlan(blueprints, options)
    const execution = await openExecution({
      roots,
      preparation: collectModulePreparation(blueprints),
      shape: describeExecutionPlan(plan.allNodes),
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
    send({ type: 'result', result, reporter })
  } catch (error) {
    send({ type: 'error', message: String(error?.stack ?? error) })
  } finally {
    await runtime?.close()
    await compiler?.close()
  }
}
collectAndRun().catch((error) => send({ type: 'error', message: String(error?.stack ?? error) }))
