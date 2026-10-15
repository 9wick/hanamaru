import { Config, createApp } from '@zeltjs/core'
import { onNode } from '@zeltjs/adapter-node'
import { parentPort, workerData as rawWorkerData } from 'node:worker_threads'
import * as v from 'valibot'
import { errorStack } from '@hanamaru/cli/application/collection/failure'
import { ModuleEntry } from '@hanamaru/module-runtime/infrastructure/modules/entry'
import { CollectionFeature } from '@hanamaru/cli/infrastructure/workers/features'
import { cliWorkerDataSchema } from '@hanamaru/cli/infrastructure/workers/schemas'
import { captureConsole } from './capture-console.js'

if (!parentPort) throw new Error('collection requires a worker thread')
captureConsole()
const port = parentPort
const workerData = v.parse(cliWorkerDataSchema, rawWorkerData)

@Config()
class PublicEntry extends ModuleEntry {
  override readonly url = new URL('./index.js', import.meta.url)
}

const app = createApp([new CollectionFeature()], { configs: [PublicEntry] })

try {
  const nodeApp = await onNode(app)
  try {
    await nodeApp.collection.run(workerData, port, workerData.executionPort)
  } finally {
    await nodeApp.shutdown().catch((error: unknown) => nodeApp.collection.fail(error))
  }
} catch (error) {
  process.stderr.write(`${errorStack(error)}\n`)
}
