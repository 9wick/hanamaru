import { Config, createApp } from '@zeltjs/core'
import { onNode } from '@zeltjs/adapter-node'
import { parentPort, workerData as rawWorkerData } from 'node:worker_threads'
import * as v from 'valibot'
import { errorStack } from './foundation/errors.js'
import { ProjectFilesystem } from './infrastructure/filesystem/project-files.js'
import { ModuleEntry } from './infrastructure/modules/entry.js'
import { WorkerExecutionLauncher } from './infrastructure/workers/client.js'
import { CollectionChannel } from './infrastructure/workers/collection-channel.js'
import { CollectionEnvironment } from './infrastructure/workers/environment.js'
import { CollectionFeature } from './infrastructure/workers/features.js'
import { WorkerModuleToolchain } from './infrastructure/workers/module-toolchain.js'
import { cliWorkerDataSchema } from './infrastructure/workers/schemas.js'
import { captureConsole, StderrLog } from './infrastructure/workers/stderr-log.js'

if (!parentPort) throw new Error('collection requires a worker thread')
captureConsole()
const port = parentPort
const workerData = v.parse(cliWorkerDataSchema, rawWorkerData)

@Config()
class WorkerEnvironment extends CollectionEnvironment {
  override readonly port = port
  override readonly executionPort = workerData.executionPort
}

@Config()
class PublicEntry extends ModuleEntry {
  override readonly url = new URL('./index.js', import.meta.url)
}

const app = createApp([new CollectionFeature()], {
  configs: [
    WorkerEnvironment,
    PublicEntry,
    ProjectFilesystem,
    StderrLog,
    CollectionChannel,
    WorkerModuleToolchain,
    WorkerExecutionLauncher,
  ],
})

try {
  const nodeApp = await onNode(app)
  try {
    await nodeApp.collection.run(workerData)
  } finally {
    await nodeApp.shutdown().catch((error: unknown) => nodeApp.collection.fail(error))
  }
} catch (error) {
  process.stderr.write(`${errorStack(error)}\n`)
}
