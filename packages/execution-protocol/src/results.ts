import * as v from 'valibot'
type Value = unknown
import type { DiagnosticValue } from './result-types.js'

export const phaseSchema = v.picklist([
  'prepare',
  'compile',
  'before',
  'target',
  'checkpoint',
  'observe',
  'assert',
  'cleanup',
])

const cleanup = v.picklist(['complete', 'incomplete'])

export const reason = v.nullable(v.picklist(['timeout', 'interrupted', 'cleanup-failed']))

export const location = v.object({ file: v.string(), line: v.number(), column: v.number() })

const diagnosticKey = v.variant('kind', [
  v.object({ kind: v.literal('string'), value: v.string() }),
  v.object({ kind: v.literal('symbol'), id: v.number(), description: v.nullable(v.string()) }),
])

export const diagnosticSchema: v.GenericSchema<Value, DiagnosticValue> = v.lazy(() =>
  v.variant('kind', [
    v.object({ kind: v.picklist(['undefined', 'null', 'hole', 'missing']) }),
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

const observation = v.intersect([
  v.object({
    refId: v.number(),
    tokenId: v.number(),
    evidence: v.picklist(['real-effect', 'substitute-effect', 'call-record']),
  }),
  v.variant('kind', [
    v.object({
      kind: v.literal('state'),
      args: v.array(diagnosticSchema),
      timing: v.variant('kind', [
        v.object({ kind: v.literal('before') }),
        v.object({
          kind: v.literal('after-plan'),
          wait: v.optional(v.object({ withinMs: v.number(), intervalMs: v.number() })),
        }),
        v.object({ kind: v.literal('after-step'), operationIndex: v.number() }),
      ]),
    }),
    v.object({
      kind: v.literal('action'),
      window: v.variant('kind', [
        v.object({ kind: v.literal('settled') }),
        v.object({ kind: v.literal('after'), milliseconds: v.number() }),
      ]),
    }),
  ]),
])

export const assertionReferenceSchema = v.strictObject({
  observations: v.optional(v.array(observation)),
  adapterType: v.optional(diagnosticSchema),
  errorTypes: v.optional(v.array(diagnosticSchema)),
  operationIndex: v.optional(v.number()),
  index: v.number(),
  source: v.literal('expect'),
  subject: v.picklist(['result', 'error', 'state', 'action', 'property', 'outcome']),
  matcher: v.picklist(['toEqual', 'toBe', 'toBeCloseTo', 'satisfies', 'unchanged', 'count']),
  path: v.optional(v.array(v.union([v.string(), v.number()]))),
  evidence: v.optional(v.picklist(['real-effect', 'substitute-effect', 'call-record'])),
})

const outcome = v.object({ kind: v.picklist(['return', 'throw']), value: diagnosticSchema })

export const failureSchema = v.variant('kind', [
  v.object({
    kind: v.literal('assertion'),
    phase: v.literal('assert'),
    message: v.string(),
    assertion: assertionReferenceSchema,
    expected: diagnosticSchema,
    actual: diagnosticSchema,
  }),
  v.object({
    kind: v.literal('outcome'),
    operationIndex: v.optional(v.number()),
    phase: v.literal('target'),
    message: v.string(),
    expected: v.picklist(['return', 'throw']),
    actual: outcome,
  }),
  v.object({
    kind: v.literal('observation'),
    phase: phaseSchema,
    message: v.string(),
    observation,
    stage: v.picklist(['before', 'after', 'open', 'finish', 'dispose']),
    cause: diagnosticSchema,
    assertion: v.optional(assertionReferenceSchema),
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
    failureIndexes: v.array(v.number()),
    assertion: assertionReferenceSchema,
    status: v.picklist(['passed', 'failed']),
    expected: diagnosticSchema,
    actual: diagnosticSchema,
  }),
  v.object({
    failureIndexes: v.array(v.number()),
    assertion: assertionReferenceSchema,
    status: v.literal('not-evaluated'),
    pending: v.optional(v.literal(true)),
    reason: v.string(),
  }),
])

export const operationResult = v.intersect([
  v.object({
    failureIndexes: v.array(v.number()),
    index: v.number(),
    key: v.string(),
    mode: v.picklist(['return-required', 'final']),
  }),
  v.variant('status', [
    v.object({ status: v.literal('returned'), args: v.array(diagnosticSchema), value: diagnosticSchema }),
    v.object({ status: v.literal('threw'), args: v.array(diagnosticSchema), value: diagnosticSchema }),
    v.object({ status: v.literal('not-run'), reason: v.string() }),
    v.object({ status: v.literal('incomplete'), args: v.array(diagnosticSchema), reason: v.string() }),
  ]),
])
const propertyEvaluation = v.object({
  kind: v.picklist(['example', 'generated', 'shrink']),
  sampleIndex: v.nullable(v.number()),
  input: diagnosticSchema,
  operations: v.array(operationResult),
  expectedTermination: v.nullable(v.picklist(['return', 'throw', 'return-or-throw'])),
  terminationTarget: v.nullable(v.number()),
  status: v.picklist(['passed', 'failed', 'cancelled']),
  outcome: v.nullable(outcome),
  assertions: v.array(assertionResult),
  failureIndexes: v.array(v.number()),
  cleanup,
})
const propertyRun = v.object({
  source: diagnosticSchema,
  classification: v.picklist(['fixed', 'generated']),
  seed: v.number(),
  version: v.number(),
  runs: v.number(),
  maxShrinks: v.number(),
  originalCounterexample: v.nullable(diagnosticSchema),
  counterexample: v.nullable(diagnosticSchema),
  shrinkPath: v.array(v.number()),
  stopped: v.picklist(['completed', 'counterexample', 'max-shrinks', 'execution-failed', 'interrupted']),
})
export const attempt = v.object({
  selectedEvaluationIndex: v.optional(v.number()),
  operations: v.optional(v.array(operationResult)),
  expectedTermination: v.optional(v.nullable(v.picklist(['return', 'throw', 'return-or-throw']))),
  terminationTarget: v.optional(v.nullable(v.number())),
  evaluations: v.optional(v.array(propertyEvaluation)),
  property: v.optional(propertyRun),
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

export { location as locationSchema }
