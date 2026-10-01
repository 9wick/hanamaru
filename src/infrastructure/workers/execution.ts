import { Config, createApp } from '@zeltjs/core'
import { parentPort, workerData as rawWorkerData } from 'node:worker_threads'
import * as v from 'valibot'
import { errorStack } from '../../foundation/errors.js'
import { ValueComparison } from '../comparison.js'
import { ExecutionEnvironment } from './environment.js'
import { ExecutionWorker } from './execution-worker.js'
import { ChannelRunEvents, CompileRequests } from './execution-session.js'
import { RuntimeCalls } from './runtime-calls.js'
import { executionWorkerDataSchema } from './schemas.js'
import { captureConsole } from './stderr-log.js'

if (!parentPort) throw new Error('execution requires a worker thread')

captureConsole()

const port = parentPort

@Config()
class WorkerEnvironment extends ExecutionEnvironment {
  override readonly port = port
}

const workerData = v.parse(executionWorkerDataSchema, rawWorkerData)

// 実行workerは親に強制終了されるため、scopeを畳む機会は持たない。立ち上げの失敗だけを人へ伝える。
createApp([])
  .createRuntime({ configs: [WorkerEnvironment, ValueComparison, CompileRequests, ChannelRunEvents, RuntimeCalls] })
  .then((scope) => scope.get(ExecutionWorker))
  .then((worker) => worker.serve(workerData))
  .catch((error: unknown) => process.stderr.write(`${errorStack(error)}\n`))
