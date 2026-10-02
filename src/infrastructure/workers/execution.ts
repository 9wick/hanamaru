import { Config, createApp } from '@zeltjs/core'
import { parentPort } from 'node:worker_threads'
import { errorStack } from '../../foundation/errors.js'
import { ValueComparison } from '../comparison.js'
import { ExecutionEnvironment } from './environment.js'
import { ExecutionWorker } from './execution-worker.js'
import { CompileRequests } from './execution-session.js'
import { captureConsole } from './stderr-log.js'

if (!parentPort) throw new Error('execution requires a worker thread')

captureConsole()

const port = parentPort

@Config()
class WorkerEnvironment extends ExecutionEnvironment {
  override readonly port = port
}

// 実行workerは親に強制終了されるため、scopeを畳む機会は持たない。立ち上げの失敗だけを人へ伝える。
createApp([])
  .createRuntime({ configs: [WorkerEnvironment, ValueComparison, CompileRequests] })
  .then((scope) => scope.get(ExecutionWorker))
  .then((worker) => worker.serve())
  .catch((error: unknown) => {
    port.postMessage({ type: 'error', message: errorStack(error) })
    port.close()
  })
