import { createApp } from '@zeltjs/core'
import { onNode } from '@zeltjs/adapter-node'
import { workerData } from 'node:worker_threads'
import * as v from 'valibot'
import { ExecutionFeature } from './execution-feature.js'
import { executionBootstrapSchema } from './execution-schemas.js'

const { port } = v.parse(executionBootstrapSchema, workerData)
const app = createApp([new ExecutionFeature()])
const nodeApp = onNode(app)
export async function serveExecutionWorker(): Promise<void> {
  ;(await nodeApp).execution.serve(port)
}
