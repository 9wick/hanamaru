import type { ResourceScope } from '@hanamaru/blueprint/model'
import type { SourceLocation } from '@hanamaru/blueprint/model'
import type { ResolvedExecutionConfig } from '../execution/config.js'
import type { AssertionResult, DiagnosticValue, Failure, GroupMiddlewareFailure, TargetOutcome } from './types.js'

export type Reason = 'timeout' | 'interrupted' | 'cleanup-failed'

export interface MutableAttempt {
  attempt: number
  status: 'passed' | 'failed' | 'cancelled'
  durationMs: number
  outcome: TargetOutcome | null
  assertions: AssertionResult[]
  failures: Failure[]
  cleanup: 'complete' | 'incomplete'
}

export interface CaseResultBase {
  name: string
  origin: SourceLocation
  path: number[]
  row: { index: number; value: DiagnosticValue } | null
  config: ResolvedExecutionConfig
}

export interface MutableCaseResult extends CaseResultBase {
  durationMs: number
  attempts: MutableAttempt[]
  notRun?: 'todo' | 'skipped' | 'cancelled'
}

export interface MutableTestResult {
  kind: 'test'
  name: string
  path: number[]
  source?: { file: string; projects: string[] }
  cases: MutableCaseResult[]
}

export interface MutableGroupMiddleware {
  status: 'passed' | 'failed' | 'cancelled' | 'not-run'
  durationMs: number
  failures: GroupMiddlewareFailure[]
  cleanup: 'complete' | 'incomplete'
  reason?: 'no-runnable-cases' | 'cancelled'
}

export interface MutableGroupResult {
  kind: 'group'
  name: string | null
  origin: SourceLocation
  middleware: MutableGroupMiddleware | null
  path: number[]
  source?: { file: string; projects: string[] }
  children: { origin: SourceLocation; result: MutableNodeResult }[]
}

export type MutableNodeResult = MutableTestResult | MutableGroupResult

export interface MutableResourceResult {
  id: number
  name: string
  scope: ResourceScope
  middleware: MutableGroupMiddleware
}

export interface MutableRunResult {
  resources?: MutableResourceResult[]
  version: 1
  status: 'passed' | 'failed' | 'cancelled'
  reason: Reason | 'completed'
  tests: MutableNodeResult[]
}
