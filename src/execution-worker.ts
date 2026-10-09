import { Config, createApp } from '@zeltjs/core'
import { onNode } from '@zeltjs/adapter-node'
import { parentPort, workerData } from 'node:worker_threads'
import * as v from 'valibot'
import { errorStack } from './foundation/errors.js'
import { ValueComparison } from './infrastructure/comparison.js'
import { ExecutionEnvironment } from './infrastructure/workers/environment.js'
import { ExecutionFeature } from './infrastructure/workers/features.js'
import { CompileRequests } from './infrastructure/workers/execution-session.js'
import { executionBootstrapSchema } from './infrastructure/workers/schemas.js'
import { captureConsole } from './infrastructure/workers/stderr-log.js'

if (!parentPort) throw new Error('execution requires a worker thread')
// 失敗を通知したあとも停止はCLIが行う。親のportを閉じただけで正常exitにはしない。
parentPort.ref()
captureConsole()
const { port } = v.parse(executionBootstrapSchema, workerData)

@Config()
class WorkerEnvironment extends ExecutionEnvironment {
  override readonly port = port
}

const app = createApp([new ExecutionFeature()], {
  configs: [WorkerEnvironment, ValueComparison, CompileRequests],
})

// 親が強制終了するworkerのため、起動したruntimeは受信の寿命まで保持する。
try {
  const nodeApp = await onNode(app)
  nodeApp.execution.serve()
} catch (error) {
  port.postMessage({ type: 'error', message: errorStack(error) })
  port.close()
}
