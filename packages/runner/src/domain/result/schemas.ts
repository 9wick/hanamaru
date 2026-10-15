import * as v from 'valibot'
import type { Value } from '../execution/javascript.js'
import { location, diagnosticSchema, attempt, groupMiddlewareSchema } from '@hanamaru/execution-protocol'
export * from '@hanamaru/execution-protocol'
export const caseResultSchema = v.object({
  name: v.string(),
  origin: location,
  path: v.array(v.number()),
  row: v.nullable(v.object({ index: v.number(), value: diagnosticSchema })),
  config: v.object({ timeout: v.number(), retry: v.number() }),
  durationMs: v.number(),
  attempts: v.array(attempt),
  notRun: v.optional(v.picklist(['todo', 'skipped', 'cancelled'])),
})

const nodeResultSchema: v.GenericSchema<Value, import('./mutable.js').MutableNodeResult> = v.lazy(() =>
  v.variant('kind', [
    v.object({
      kind: v.literal('test'),
      name: v.string(),
      path: v.array(v.number()),
      source: v.optional(v.object({ file: v.string(), projects: v.array(v.string()) })),
      cases: v.array(caseResultSchema),
    }),
    v.object({
      kind: v.literal('group'),
      name: v.nullable(v.string()),
      origin: location,
      middleware: v.nullable(groupMiddlewareSchema),
      path: v.array(v.number()),
      source: v.optional(v.object({ file: v.string(), projects: v.array(v.string()) })),
      children: v.array(v.object({ origin: location, result: nodeResultSchema })),
    }),
  ]),
)

export const resourceResultSchema = v.object({
  id: v.number(),
  name: v.string(),
  scope: v.picklist(['perRun', 'perWorker']),
  middleware: groupMiddlewareSchema,
})

export const runResultSchema = v.object({
  resources: v.optional(v.array(resourceResultSchema)),
  version: v.literal(1),
  status: v.picklist(['passed', 'failed', 'cancelled']),
  reason: v.picklist(['completed', 'timeout', 'interrupted', 'cleanup-failed']),
  tests: v.array(nodeResultSchema),
})
