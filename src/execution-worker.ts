import { Config, createApp } from '@zeltjs/core'
import { onNode } from '@zeltjs/adapter-node'
import { parentPort, workerData } from 'node:worker_threads'
import * as v from 'valibot'
import { errorStack } from '@hanamaru/execution/domain/result/exception'
import { ValueComparison } from '@hanamaru/execution/infrastructure/comparison'
import { ExecutionEnvironment } from '@hanamaru/execution/infrastructure/workers/execution-environment'
import { ExecutionFeature } from '@hanamaru/execution/infrastructure/workers/execution-feature'
import { CompileRequests } from '@hanamaru/execution/infrastructure/workers/execution-session'
import { executionBootstrapSchema } from '@hanamaru/execution/infrastructure/workers/execution-schemas'
import { captureConsole } from './capture-console.js'

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
