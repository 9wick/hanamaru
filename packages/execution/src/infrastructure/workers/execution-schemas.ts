export * from '@hanamaru/execution-protocol'
import * as v from 'valibot'
import { MessagePort } from 'node:worker_threads'
export const executionBootstrapSchema = v.object({ role: v.literal('execution'), port: v.instance(MessagePort) })
