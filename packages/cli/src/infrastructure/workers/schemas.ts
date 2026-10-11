import * as v from 'valibot'
import { MessagePort } from 'node:worker_threads'
import { progressSchema } from '@hanamaru/execution/application/execution/progress-schema'
import { runResultSchema } from '@hanamaru/execution/domain/result/schemas'
import type { CliMessage } from '../../application/collection/events.js'

export const cliWorkerDataSchema = v.object({
  executionPort: v.instance(MessagePort),
  files: v.array(v.string()),
  options: v.object({
    filter: v.optional(v.string()),
    reporter: v.optional(v.string()),
    config: v.optional(v.string()),
    projects: v.optional(v.array(v.string())),
    collectionTimeout: v.optional(v.number()),
    shutdownGrace: v.optional(v.number()),
    ci: v.optional(v.boolean()),
    failOnFlaky: v.optional(v.boolean()),
    noColor: v.optional(v.boolean()),
    help: v.optional(v.boolean()),
    version: v.optional(v.boolean()),
  }),
})

export const executionClosedSchema = v.object({ type: v.literal('execution-closed') })

const reporterSchema = v.picklist(['pretty', 'json'])

export const cliMessageSchema: v.GenericSchema<unknown, CliMessage | { type: 'close-execution' }> = v.union([
  v.object({ type: v.literal('close-execution') }),
  v.object({ type: v.literal('loading'), file: v.string(), timeout: v.number() }),
  v.object({ type: v.literal('running'), reporter: reporterSchema, shutdownGrace: v.number() }),
  v.object({ type: v.literal('progress'), progress: progressSchema }),
  v.object({ type: v.literal('timeout'), result: runResultSchema }),
  v.object({ type: v.literal('deadline'), kind: v.literal('end') }),
  v.object({ type: v.literal('deadline'), kind: v.literal('start'), timeoutMs: v.number(), progress: progressSchema }),
  v.object({ type: v.literal('result'), result: runResultSchema, reporter: reporterSchema }),
  v.object({ type: v.literal('error'), message: v.string() }),
])
