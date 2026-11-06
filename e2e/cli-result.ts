import * as v from 'valibot'
import type { CaseResult, DiagnosticValue, Failure, GroupResult, TestResult } from 'hanamaru'

// CLIの公開JSON契約を観測する。実装のtransport schema・mutable modelは参照しない。
const origin = v.object({ file: v.string(), line: v.number(), column: v.number() })
const cleanup = v.picklist(['complete', 'incomplete'])
const phase = v.picklist(['prepare', 'compile', 'before', 'target', 'checkpoint', 'observe', 'assert', 'cleanup'])
const key = v.union([
  v.object({ kind: v.literal('string'), value: v.string() }),
  v.object({ kind: v.literal('symbol'), id: v.number(), description: v.nullable(v.string()) }),
])
const diagnostic: v.GenericSchema<unknown, DiagnosticValue> = v.lazy(() =>
  v.union([
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
      items: v.array(diagnostic),
      properties: v.array(v.object({ key, value: diagnostic })),
    }),
    v.object({
      kind: v.literal('object'),
      id: v.number(),
      type: v.string(),
      properties: v.array(v.object({ key, value: diagnostic })),
      omitted: v.array(v.string()),
    }),
    v.object({ kind: v.literal('date'), id: v.number(), value: v.nullable(v.string()) }),
    v.object({ kind: v.literal('regexp'), id: v.number(), source: v.string(), flags: v.string() }),
    v.object({ kind: v.literal('map'), id: v.number(), entries: v.array(v.tuple([diagnostic, diagnostic])) }),
    v.object({ kind: v.literal('set'), id: v.number(), values: v.array(diagnostic) }),
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
  v.union([
    v.object({
      kind: v.literal('state'),
      args: v.array(diagnostic),
      timing: v.union([
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
      window: v.union([
        v.object({ kind: v.literal('settled') }),
        v.object({ kind: v.literal('after'), milliseconds: v.number() }),
      ]),
    }),
  ]),
])
const assertion = v.object({
  observations: v.optional(v.array(observation)),
  adapterType: v.optional(diagnostic),
  errorTypes: v.optional(v.array(diagnostic)),
  operationIndex: v.optional(v.number()),
  index: v.number(),
  source: v.literal('expect'),
  subject: v.picklist(['result', 'error', 'state', 'action', 'property', 'outcome']),
  matcher: v.picklist(['toBe', 'toEqual', 'toBeCloseTo', 'satisfies', 'unchanged', 'count']),
  path: v.optional(v.array(v.union([v.string(), v.number()]))),
  evidence: v.optional(v.picklist(['real-effect', 'substitute-effect', 'call-record'])),
})
const outcome = v.object({ kind: v.picklist(['return', 'throw']), value: diagnostic })
const failure: v.GenericSchema<unknown, Failure> = v.union([
  v.object({
    kind: v.literal('assertion'),
    phase: v.literal('assert'),
    message: v.string(),
    assertion,
    expected: diagnostic,
    actual: diagnostic,
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
    phase: phase,
    message: v.string(),
    observation,
    stage: v.picklist(['before', 'after', 'open', 'finish', 'dispose']),
    cause: diagnostic,
    assertion: v.optional(assertion),
  }),
  v.object({
    kind: v.literal('execution'),
    phase,
    message: v.string(),
    cause: diagnostic,
    assertion: v.optional(assertion),
  }),
  v.object({
    kind: v.literal('timeout'),
    phase,
    message: v.string(),
    timeoutMs: v.number(),
    cleanup,
    stage: v.optional(v.picklist(['before', 'after'])),
  }),
])
const assertions = v.array(
  v.union([
    v.object({
      failureIndexes: v.array(v.number()),
      assertion,
      status: v.picklist(['passed', 'failed']),
      expected: diagnostic,
      actual: diagnostic,
    }),
    v.object({
      failureIndexes: v.array(v.number()),
      assertion,
      status: v.literal('not-evaluated'),
      pending: v.optional(v.literal(true)),
      reason: v.string(),
    }),
  ]),
)
const operation = v.intersect([
  v.object({
    failureIndexes: v.array(v.number()),
    index: v.number(),
    key: v.string(),
    mode: v.picklist(['return-required', 'final']),
  }),
  v.union([
    v.object({ status: v.picklist(['returned', 'threw']), args: v.array(diagnostic), value: diagnostic }),
    v.object({ status: v.literal('not-run'), reason: v.string() }),
    v.object({ status: v.literal('incomplete'), args: v.array(diagnostic), reason: v.string() }),
  ]),
])
const attempt = v.object({
  selectedEvaluationIndex: v.optional(v.number()),
  operations: v.optional(v.array(operation)),
  expectedTermination: v.optional(v.nullable(v.picklist(['return', 'throw', 'return-or-throw']))),
  terminationTarget: v.optional(v.nullable(v.number())),
  attempt: v.number(),
  status: v.picklist(['passed', 'failed', 'cancelled']),
  durationMs: v.number(),
  outcome: v.nullable(outcome),
  assertions,
  failures: v.array(failure),
  cleanup,
  evaluations: v.optional(
    v.array(
      v.object({
        kind: v.picklist(['example', 'generated', 'shrink']),
        sampleIndex: v.nullable(v.number()),
        input: diagnostic,
        operations: v.array(operation),
        expectedTermination: v.nullable(v.picklist(['return', 'throw', 'return-or-throw'])),
        terminationTarget: v.nullable(v.number()),
        status: v.picklist(['passed', 'failed', 'cancelled']),
        outcome: v.nullable(outcome),
        assertions,
        failureIndexes: v.array(v.number()),
        cleanup,
      }),
    ),
  ),
  property: v.optional(
    v.object({
      source: diagnostic,
      classification: v.picklist(['fixed', 'generated']),
      seed: v.number(),
      version: v.number(),
      runs: v.number(),
      maxShrinks: v.number(),
      originalCounterexample: v.nullable(diagnostic),
      counterexample: v.nullable(diagnostic),
      shrinkPath: v.array(v.number()),
      stopped: v.picklist(['completed', 'counterexample', 'max-shrinks', 'execution-failed', 'interrupted']),
    }),
  ),
})
const middleware = v.object({
  status: v.picklist(['passed', 'failed', 'cancelled', 'not-run']),
  durationMs: v.number(),
  cleanup,
  reason: v.optional(v.picklist(['no-runnable-cases', 'cancelled'])),
  failures: v.array(
    v.union([
      v.object({
        kind: v.literal('execution'),
        phase: v.picklist(['before', 'after', 'contract']),
        message: v.string(),
        cause: diagnostic,
      }),
      v.object({
        kind: v.literal('timeout'),
        phase: v.picklist(['before', 'after', 'contract']),
        message: v.string(),
        timeoutMs: v.number(),
      }),
    ]),
  ),
})
const caseResult = v.object({
  caseKind: v.picklist(['example', 'property', 'todo']),
  characteristic: v.picklist(['pure', 'effectful']),
  name: v.string(),
  origin,
  path: v.array(v.number()),
  row: v.nullable(v.object({ index: v.number(), value: diagnostic })),
  config: v.object({ timeout: v.number(), retry: v.number() }),
  durationMs: v.number(),
  attempts: v.array(attempt),
  notRun: v.optional(v.picklist(['todo', 'skipped', 'cancelled'])),
})
export type ObservedCase = v.InferOutput<typeof caseResult>
export type ObservedMiddleware = v.InferOutput<typeof middleware>
export type ObservedTest = Pick<TestResult, 'kind' | 'name' | 'path' | 'source'> & {
  readonly cases: readonly ObservedCase[]
}
export type ObservedGroup = Pick<GroupResult, 'kind' | 'name' | 'path' | 'source' | 'origin'> & {
  readonly middleware: ObservedMiddleware | null
  readonly children: readonly { readonly origin: CaseResult['origin']; readonly result: ObservedNode }[]
}
export type ObservedNode = ObservedTest | ObservedGroup
const source = v.optional(v.object({ file: v.string(), projects: v.array(v.string()) }))
const node: v.GenericSchema<unknown, ObservedNode> = v.lazy(() =>
  v.union([
    v.object({
      kind: v.literal('test'),
      name: v.string(),
      path: v.array(v.number()),
      source,
      cases: v.array(caseResult),
    }),
    v.object({
      kind: v.literal('group'),
      name: v.nullable(v.string()),
      path: v.array(v.number()),
      source,
      origin,
      middleware: v.nullable(middleware),
      children: v.array(v.object({ origin, result: node })),
    }),
  ]),
)
const result = v.object({
  version: v.literal(1),
  status: v.picklist(['passed', 'failed', 'cancelled']),
  reason: v.picklist(['completed', 'timeout', 'interrupted', 'cleanup-failed']),
  tests: v.array(node),
  resources: v.optional(
    v.array(v.object({ id: v.number(), name: v.string(), scope: v.picklist(['perRun', 'perWorker']), middleware })),
  ),
})
export type ParsedRunResult = v.InferOutput<typeof result>

export function readCliResult(stdout: string): ParsedRunResult {
  return v.parse(result, JSON.parse(stdout))
}
