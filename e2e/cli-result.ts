import * as v from 'valibot'
import type { CaseResult, DiagnosticValue, Failure, GroupResult, TestResult } from 'hanamaru'

// CLIの公開JSON契約を観測する。実装のtransport schema・mutable modelは参照しない。
const origin = v.object({ file: v.string(), line: v.number(), column: v.number() })
const cleanup = v.picklist(['complete', 'incomplete'])
const phase = v.picklist(['middleware', 'instrumentation', 'args', 'target', 'expect', 'assertion', 'cleanup'])
const key = v.union([
  v.object({ kind: v.literal('string'), value: v.string() }),
  v.object({ kind: v.literal('symbol'), id: v.number(), description: v.nullable(v.string()) }),
])
const diagnostic: v.GenericSchema<unknown, DiagnosticValue> = v.lazy(() =>
  v.union([
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
const assertion = v.union([
  v.object({
    index: v.number(),
    source: v.literal('expect'),
    subject: v.literal('result'),
    negated: v.optional(v.literal(true)),
    matcher: v.picklist(['toBe', 'toEqual', 'toMatchObject', 'toSatisfy']),
  }),
  v.object({
    index: v.number(),
    source: v.literal('expect'),
    subject: v.literal('error'),
    negated: v.optional(v.literal(true)),
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
const outcome = v.object({ kind: v.picklist(['return', 'throw']), value: diagnostic })
const failure: v.GenericSchema<unknown, Failure> = v.union([
  v.object({
    kind: v.literal('assertion'),
    phase: v.literal('assertion'),
    message: v.string(),
    assertion,
    expected: diagnostic,
    actual: diagnostic,
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
const attempt = v.object({
  attempt: v.number(),
  status: v.picklist(['passed', 'failed', 'cancelled']),
  durationMs: v.number(),
  outcome: v.nullable(outcome),
  assertions: v.array(
    v.union([
      v.object({ assertion, status: v.picklist(['passed', 'failed']), expected: diagnostic, actual: diagnostic }),
      v.object({ assertion, status: v.literal('not-evaluated'), reason: v.string() }),
    ]),
  ),
  failures: v.array(failure),
  cleanup,
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
