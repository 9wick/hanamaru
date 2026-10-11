import * as v from 'valibot'
import { MessagePort } from 'node:worker_threads'
import { attempt, groupMiddlewareSchema, location, phaseSchema, reason } from '../../domain/result/schemas.js'

export const replySchema = v.union([
  v.object({ result: attempt, retryable: v.boolean(), reason: v.optional(reason) }),
  v.object({ middleware: groupMiddlewareSchema, reason, entered: v.optional(v.literal(false)) }),
  v.object({ entered: v.literal(true) }),
])

const jsValue = v.union([
  v.undefined(),
  v.null(),
  v.boolean(),
  v.number(),
  v.bigint(),
  v.string(),
  v.symbol(),
  v.instance(Object),
  v.function(),
])

// Protocol values are validated before use; object contents are checked at the module boundary.
export const executionMessageSchema = v.variant('type', [
  v.object({ type: v.literal('compile'), id: v.number(), name: v.string(), args: v.array(jsValue) }),
  v.object({ type: v.literal('ready') }),
  v.object({ type: v.literal('loading'), file: v.string() }),
  v.object({ type: v.literal('error'), message: v.string() }),
  v.object({ type: v.literal('reply'), id: v.number(), value: replySchema }),
  v.object({ type: v.literal('timeout'), phase: v.optional(phaseSchema) }),
  v.object({
    type: v.literal('group-stage'),
    path: v.array(v.number()),
    stage: v.picklist(['before', 'inside', 'after', 'end', 'contract']),
    timeoutMs: v.number(),
  }),
])

const commandSchemas = [
  v.object({
    type: v.literal('attempt'),
    id: v.number(),
    path: v.array(v.number()),
    number: v.number(),
    resourceFields: v.optional(v.record(v.string(), jsValue)),
  }),
  v.object({
    type: v.literal('group-open'),
    id: v.number(),
    path: v.array(v.number()),
    resourceFields: v.optional(v.record(v.string(), jsValue)),
  }),
  v.object({ type: v.literal('group-close'), id: v.number(), path: v.array(v.number()), failed: v.boolean() }),
]

export const executionWorkerDataSchema = v.object({
  roots: v.array(v.object({ file: v.string(), index: v.number(), origin: location })),
  preparation: v.array(v.object({ id: v.string(), keys: v.array(v.string()) })),
  shape: v.string(),
})

export const executionIncomingSchema = v.variant('type', [
  ...commandSchemas,
  v.object({ type: v.literal('initialize'), spec: executionWorkerDataSchema }),
  v.object({ type: v.literal('interrupt') }),
  v.object({ type: v.literal('compiled'), id: v.number(), result: v.optional(jsValue), error: v.optional(v.string()) }),
])

export const executionBootstrapSchema = v.object({ role: v.literal('execution'), port: v.instance(MessagePort) })
