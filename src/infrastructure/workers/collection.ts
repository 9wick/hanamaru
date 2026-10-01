import { Config, createApp } from '@zeltjs/core'
import { parentPort, workerData as rawWorkerData } from 'node:worker_threads'
import * as v from 'valibot'
import { CollectionEvents } from '../../application/collection/events.js'
import { errorStack } from '../../foundation/errors.js'
import { ValueComparison } from '../comparison.js'
import { ProjectFilesystem } from '../filesystem/project-files.js'
import { ModuleEntry } from '../modules/entry.js'
import { WorkerExecutionLauncher } from './client.js'
import { CollectionChannel } from './collection-channel.js'
import { CollectionWorker } from './collection-worker.js'
import { CollectionEnvironment } from './environment.js'
import { WorkerModuleToolchain } from './module-toolchain.js'
import { cliWorkerDataSchema } from './schemas.js'
import { captureConsole, StderrLog } from './stderr-log.js'

/** zeltはscopeの解放で起きた失敗をまとめて包む。失敗が1つだけなら、元の失敗をそのまま見せる。 */
function released(error: unknown): unknown {
  return error instanceof AggregateError && error.errors.length === 1 ? error.errors[0] : error
}

export function startCollection(runtimeURL: URL, executionWorkerURL: URL): void {
  if (!parentPort) throw new Error('collection requires a worker thread')
  captureConsole()
  const port = parentPort

  @Config()
  class WorkerEnvironment extends CollectionEnvironment {
    override readonly port = port
    override readonly executionWorkerURL = executionWorkerURL
  }

  @Config()
  class PublicEntry extends ModuleEntry {
    override readonly url = runtimeURL
  }

  const workerData = v.parse(cliWorkerDataSchema, rawWorkerData)
  createApp([])
    .createRuntime({
      configs: [
        WorkerEnvironment,
        PublicEntry,
        ProjectFilesystem,
        ValueComparison,
        StderrLog,
        CollectionChannel,
        WorkerModuleToolchain,
        WorkerExecutionLauncher,
      ],
    })
    .then(async (scope) => {
      const events = await scope.get(CollectionEvents)
      const worker = await scope.get(CollectionWorker)
      try {
        await worker.run(workerData)
      } finally {
        // scopeを畳む途中の失敗も収集の失敗と同じ通り道で伝える。
        await scope.shutdown().catch((error: unknown) => events.error(errorStack(released(error))))
      }
    })
    .catch((error: unknown) => process.stderr.write(`${errorStack(error)}\n`))
}
