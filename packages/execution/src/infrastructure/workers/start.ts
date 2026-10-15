import { Config, createApp } from '@zeltjs/core'
import { onNode } from '@zeltjs/adapter-node'
import { workerData } from 'node:worker_threads'
import * as v from 'valibot'
import { ValueComparison } from '../comparison.js'
import { ExecutionEnvironment } from './execution-environment.js'
import { ExecutionFeature } from './execution-feature.js'
import { CompileRequests } from './execution-session.js'
import { executionBootstrapSchema } from './execution-schemas.js'

const { port } = v.parse(executionBootstrapSchema, workerData)
@Config()
class WorkerEnvironment extends ExecutionEnvironment {
  override readonly port = port
}
const app = createApp([new ExecutionFeature()], { configs: [WorkerEnvironment, ValueComparison, CompileRequests] })
const nodeApp = onNode(app)
export async function serveExecutionWorker(): Promise<void> {
  ;(await nodeApp).execution.serve()
}
