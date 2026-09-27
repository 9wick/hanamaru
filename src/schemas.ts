import * as v from 'valibot'
import type { Value } from './value.js'
import type { DiagnosticValue } from './api.js'
export const phaseSchema = v.picklist([
  'middleware',
  'instrumentation',
  'args',
  'target',
  'expect',
  'assertion',
  'cleanup',
])
const cleanup = v.picklist(['complete', 'incomplete'])
const reason = v.nullable(v.picklist(['timeout', 'interrupted', 'cleanup-failed']))
const location = v.object({ file: v.string(), line: v.number(), column: v.number() })
const diagnosticKey = v.variant('kind', [
  v.object({ kind: v.literal('string'), value: v.string() }),
  v.object({ kind: v.literal('symbol'), id: v.number(), description: v.nullable(v.string()) }),
])
export const diagnosticSchema: v.GenericSchema<Value, DiagnosticValue> = v.lazy(() =>
  v.variant('kind', [
    v.object({ kind: v.picklist(['undefined', 'null', 'hole']) }),
    v.object({ kind: v.literal('boolean'), value: v.boolean() }),
    v.object({ kind: v.literal('string'), value: v.string() }),
    v.object({
      kind: v.literal('number'),
      value: v.union([v.number(), v.picklist(['NaN', 'Infinity', '-Infinity', '-0'])]),
    }),
    v.object({ kind: v.literal('bigint'), value: v.string() }),
    v.object({ kind: v.literal('symbol'), id: v.number(), description: v.nullable(v.string()) }),
    v.object({ kind: v.literal('function'), id: v.number(), name: v.string() }),
    v.object({
      kind: v.literal('array'),
      id: v.number(),
      items: v.array(diagnosticSchema),
      properties: v.array(v.object({ key: diagnosticKey, value: diagnosticSchema })),
    }),
    v.object({
      kind: v.literal('object'),
      id: v.number(),
      type: v.string(),
      properties: v.array(v.object({ key: diagnosticKey, value: diagnosticSchema })),
      omitted: v.array(v.string()),
    }),
    v.object({ kind: v.literal('date'), id: v.number(), value: v.nullable(v.string()) }),
    v.object({ kind: v.literal('regexp'), id: v.number(), source: v.string(), flags: v.string() }),
    v.object({
      kind: v.literal('map'),
      id: v.number(),
      entries: v.array(v.tuple([diagnosticSchema, diagnosticSchema])),
    }),
    v.object({ kind: v.literal('set'), id: v.number(), values: v.array(diagnosticSchema) }),
    v.object({ kind: v.literal('reference'), id: v.number() }),
    v.object({ kind: v.literal('accessor'), get: v.boolean(), set: v.boolean() }),
    v.object({ kind: v.literal('omitted'), reason: v.string() }),
  ]),
)
export const assertionReferenceSchema = v.union([
  v.object({
    index: v.number(),
    source: v.literal('expect'),
    subject: v.literal('result'),
    matcher: v.picklist(['toBe', 'toEqual', 'toMatchObject', 'toSatisfy']),
  }),
  v.object({
    index: v.number(),
    source: v.literal('expect'),
    subject: v.literal('error'),
    matcher: v.picklist(['toBeInstanceOf', 'toThrow', 'toMatchObject', 'toSatisfy']),
  }),
  v.object({
    index: v.number(),
    source: v.literal('expectCalls'),
    subject: v.literal('call'),
    key: v.string(),
    matcher: v.picklist(['calledTimes', 'notCalled', 'calledWith', 'calledOnceWith', 'calledNthWith']),
  }),
])
const outcome = v.object({ kind: v.picklist(['return', 'throw']), value: diagnosticSchema })
export const failureSchema = v.variant('kind', [
  v.object({
    kind: v.literal('assertion'),
    phase: v.literal('assertion'),
    message: v.string(),
    assertion: assertionReferenceSchema,
    expected: diagnosticSchema,
    actual: diagnosticSchema,
  }),
  v.object({
    kind: v.literal('outcome'),
    phase: v.literal('target'),
    message: v.string(),
    expected: v.picklist(['return', 'throw']),
    actual: outcome,
  }),
  v.object({
    kind: v.literal('execution'),
    phase: phaseSchema,
    message: v.string(),
    cause: diagnosticSchema,
    assertion: v.optional(assertionReferenceSchema),
  }),
  v.object({
    kind: v.literal('timeout'),
    phase: phaseSchema,
    message: v.string(),
    timeoutMs: v.number(),
    cleanup,
    stage: v.optional(v.picklist(['before', 'after'])),
  }),
])
const assertionResult = v.variant('status', [
  v.object({
    assertion: assertionReferenceSchema,
    status: v.picklist(['passed', 'failed']),
    expected: diagnosticSchema,
    actual: diagnosticSchema,
  }),
  v.object({ assertion: assertionReferenceSchema, status: v.literal('not-evaluated'), reason: v.string() }),
])
const attempt = v.object({
  attempt: v.number(),
  status: v.picklist(['passed', 'failed', 'cancelled']),
  durationMs: v.number(),
  outcome: v.nullable(outcome),
  assertions: v.array(assertionResult),
  failures: v.array(failureSchema),
  cleanup,
})
const groupFailure = v.variant('kind', [
  v.object({
    kind: v.literal('execution'),
    message: v.string(),
    phase: v.picklist(['before', 'after', 'contract']),
    cause: diagnosticSchema,
  }),
  v.object({
    kind: v.literal('timeout'),
    message: v.string(),
    phase: v.picklist(['before', 'after', 'contract']),
    timeoutMs: v.number(),
  }),
])
export const groupMiddlewareSchema = v.object({
  status: v.picklist(['passed', 'failed', 'cancelled', 'not-run']),
  durationMs: v.number(),
  failures: v.array(groupFailure),
  cleanup,
  reason: v.optional(v.picklist(['no-runnable-cases', 'cancelled'])),
})
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
  v.object({ type: v.literal('attempt'), id: v.number(), path: v.array(v.number()), number: v.number() }),
  v.object({ type: v.literal('group-open'), id: v.number(), path: v.array(v.number()) }),
  v.object({ type: v.literal('group-close'), id: v.number(), path: v.array(v.number()), failed: v.boolean() }),
]
export const executionIncomingSchema = v.variant('type', [
  ...commandSchemas,
  v.object({ type: v.literal('interrupt') }),
  v.object({ type: v.literal('compiled'), id: v.number(), result: v.optional(jsValue), error: v.optional(v.string()) }),
])
export const executionWorkerDataSchema = v.object({
  roots: v.array(v.object({ file: v.string(), name: v.string() })),
  preparation: v.array(v.object({ id: v.string(), keys: v.array(v.string()) })),
  shape: v.string(),
})
export const cliWorkerDataSchema = v.object({
  files: v.array(v.string()),
  options: v.object({
    filter: v.optional(v.string()),
    reporter: v.optional(v.string()),
    config: v.optional(v.string()),
    collectionTimeout: v.optional(v.number()),
    shutdownGrace: v.optional(v.number()),
    ci: v.optional(v.boolean()),
    failOnFlaky: v.optional(v.boolean()),
    noColor: v.optional(v.boolean()),
    help: v.optional(v.boolean()),
    version: v.optional(v.boolean()),
  }),
})
export const configSchema = v.object({
  vite: v.optional(v.looseObject({})),
  include: v.optional(v.array(v.string())),
  exclude: v.optional(v.array(v.string())),
  reporter: v.optional(v.picklist(['pretty', 'json'])),
  collectionTimeout: v.optional(v.number()),
  shutdownGrace: v.optional(v.number()),
})
export { location as locationSchema }

const caseResultSchema = v.object({
  name: v.string(),
  origin: location,
  path: v.array(v.number()),
  row: v.nullable(v.object({ index: v.number(), value: diagnosticSchema })),
  config: v.object({ timeout: v.number(), retry: v.number() }),
  durationMs: v.number(),
  attempts: v.array(attempt),
  notRun: v.optional(v.picklist(['todo', 'skipped', 'cancelled'])),
})
const nodeResultSchema: v.GenericSchema<Value, import('./internal.js').MutableNodeResult> = v.lazy(() =>
  v.variant('kind', [
    v.object({
      kind: v.literal('test'),
      name: v.string(),
      path: v.array(v.number()),
      cases: v.array(caseResultSchema),
    }),
    v.object({
      kind: v.literal('group'),
      name: v.nullable(v.string()),
      origin: location,
      middleware: v.nullable(groupMiddlewareSchema),
      path: v.array(v.number()),
      children: v.array(v.object({ origin: location, result: nodeResultSchema })),
    }),
  ]),
)
export const runResultSchema = v.object({
  version: v.literal(1),
  status: v.picklist(['passed', 'failed', 'cancelled']),
  reason: v.picklist(['completed', 'timeout', 'interrupted', 'cleanup-failed']),
  tests: v.array(nodeResultSchema),
})
const reporterSchema = v.picklist(['pretty', 'json'])
export const cliMessageSchema = v.union([
  v.object({ type: v.literal('loading'), file: v.string(), timeout: v.number() }),
  v.object({ type: v.literal('running'), reporter: reporterSchema, shutdownGrace: v.number() }),
  v.object({ type: v.picklist(['progress', 'timeout']), result: runResultSchema }),
  v.object({ type: v.literal('deadline'), kind: v.literal('end') }),
  v.object({ type: v.literal('deadline'), kind: v.literal('start'), timeoutMs: v.number(), result: runResultSchema }),
  v.object({ type: v.literal('result'), result: runResultSchema, reporter: reporterSchema }),
  v.object({ type: v.literal('error'), message: v.string() }),
])
