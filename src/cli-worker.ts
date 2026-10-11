import { Config, createApp } from '@zeltjs/core'
import { onNode } from '@zeltjs/adapter-node'
import { parentPort, workerData as rawWorkerData } from 'node:worker_threads'
import * as v from 'valibot'
import { errorStack } from '@hanamaru/cli/application/collection/failure'
import { ProjectFilesystem } from '@hanamaru/cli/infrastructure/filesystem/project-files'
import { ModuleEntry } from '@hanamaru/module-runtime/infrastructure/modules/entry'
import { WorkerExecutionLauncher } from '@hanamaru/cli/infrastructure/workers/client'
import { CollectionChannel } from '@hanamaru/cli/infrastructure/workers/collection-channel'
import { CollectionEnvironment } from '@hanamaru/cli/infrastructure/workers/environment'
import { CollectionFeature } from '@hanamaru/cli/infrastructure/workers/features'
import { WorkerModuleToolchain } from '@hanamaru/cli/infrastructure/workers/module-toolchain'
import { cliWorkerDataSchema } from '@hanamaru/cli/infrastructure/workers/schemas'
import { StderrLog } from '@hanamaru/cli/infrastructure/workers/stderr-log'
import { captureConsole } from './capture-console.js'

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
