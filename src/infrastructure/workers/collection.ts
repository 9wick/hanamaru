import { parentPort, workerData as rawWorkerData } from 'node:worker_threads'
import * as v from 'valibot'
import { CollectionEvents } from '../../application/collection/events.js'
import { loadConfig } from '../../application/collection/load-config.js'
import { CollectionSession } from '../../application/collection/session.js'
import { errorStack } from '../../foundation/errors.js'
import * as comparison from '../comparison.js'
import { ProjectFilesystem } from '../filesystem/project-files.js'
import { ModuleRegistry } from '../modules/reference.js'
import { WorkerExecutor } from './client.js'
import { CollectionChannel } from './collection-channel.js'
import { WorkerModuleToolchain } from './module-toolchain.js'
import { cliWorkerDataSchema } from './schemas.js'
import { StderrLog } from './stderr-log.js'

export function startCollection(runtimeURL: URL, executionWorkerURL: URL): void {
  if (!parentPort) throw new Error('collection requires a worker thread')
  const log = new StderrLog()
  log.captureConsole()
  const channel = new CollectionChannel(parentPort)
  const events = new CollectionEvents((event) => channel.post(event))
  const workerData = v.parse(cliWorkerDataSchema, rawWorkerData)
  const files = new ProjectFilesystem()
  const controller = new AbortController()
  channel.onInterrupt(() => controller.abort())
  const session = new CollectionSession(
    {
      comparison,
      files,
      modules: new WorkerModuleToolchain(runtimeURL, new ModuleRegistry()),
      warn: (message) => log.warn(message),
      // 実行場所はrunのtrackerとeventsを見ながら進むため、runごとにしか組み立てられない。
      openExecution: (run, services) => new WorkerExecutor(executionWorkerURL, run, services),
    },
    events,
  )
  // 設定はcompilerより先に要る。vite設定を知らないままtest runtimeを立てられない。
  loadConfig(workerData.options, files, events)
    .then((config) => session.run(workerData, config, controller.signal))
    .catch((error) => events.error(errorStack(error)))
}
