import { globSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parentPort, workerData as rawWorkerData } from 'node:worker_threads'
import * as v from 'valibot'
import { collectAndRun } from '../../application/collection/collect-and-run.js'
import type { CliMessage } from '../../application/collection/events.js'
import { errorStack } from '../../foundation/errors.js'
import type { Value } from '../../foundation/value.js'
import { property } from '../../foundation/value.js'
import * as comparison from '../comparison.js'
import { readConfig } from '../filesystem/config.js'
import { createModuleCompiler } from '../modules/compiler.js'
import { ModuleRegistry, collectModulePreparation } from '../modules/reference.js'
import { createModuleRuntime } from '../modules/runtime.js'
import { WorkerExecutor } from './client.js'
import { describeExecutionPlan } from './plan-shape.js'
import { cliWorkerDataSchema } from './schemas.js'
export function startCollection(runtimeURL: URL, executionWorkerURL: URL): void {
  if (!parentPort) throw new Error('collection requires a worker thread')
  const port = parentPort
  const workerData = v.parse(cliWorkerDataSchema, rawWorkerData)
  const consoleMethods: ('log' | 'info' | 'warn' | 'error' | 'debug')[] = ['log', 'info', 'warn', 'error', 'debug']
  for (const method of consoleMethods)
    console[method] = (...values: Value[]) => process.stderr.write(values.map(String).join(' ') + '\n')
  const send = (event: CliMessage) => port.postMessage(event)
  // module runtimeと、準備・指紋の算出は同じnamespaceの出自を見なければ噛み合わない。
  const registry = new ModuleRegistry()
  const controller = new AbortController()
  port.on('message', (message) => {
    if (property(message, 'type') === 'interrupt') controller.abort()
  })
  collectAndRun(workerData, controller.signal, send, {
    comparison,
    files: {
      resolve,
      relative: (file) => relative(process.cwd(), file),
      glob: (pattern) => [...globSync(pattern, { cwd: process.cwd() })],
      readConfig,
    },
    modules: {
      createCompiler: (vite) => createModuleCompiler(runtimeURL, vite),
      createRuntime: (invoke) => {
        const runtime = createModuleRuntime(registry, invoke)
        return { import: (file) => runtime.import(pathToFileURL(file).href), close: () => runtime.close() }
      },
      prepare: (blueprints) => collectModulePreparation(registry, blueprints),
      describe: (nodes) => describeExecutionPlan(registry, nodes),
    },
    warn: (message) => {
      process.stderr.write(message)
    },
    openExecution: (run, services) => new WorkerExecutor(executionWorkerURL, run, services),
  }).catch((error) => send({ type: 'error', message: errorStack(error) }))
}
