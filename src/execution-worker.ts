import { parentPort, workerData } from 'node:worker_threads'
import * as v from 'valibot'
import { MessagePort } from 'node:worker_threads'
import { captureConsole } from './capture-console.js'

if (!parentPort) throw new Error('execution requires a worker thread')
parentPort.ref()
captureConsole()
const { port } = v.parse(v.object({ role: v.literal('execution'), port: v.instance(MessagePort) }), workerData)
try {
  const { serveExecutionWorker } = await import('@hanamaru/execution/worker')
  await serveExecutionWorker()
} catch (error) {
  port.postMessage({ type: 'error', message: error instanceof Error ? (error.stack ?? error.message) : String(error) })
  port.close()
}
