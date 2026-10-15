import type {
  DiagnosticValue,
  TargetOutcome,
  Failure,
  AssertionResult,
  GroupMiddlewareFailure,
} from '@hanamaru/execution-protocol/data'
export type {
  DiagnosticKey,
  DiagnosticProperty,
  DiagnosticValue,
  ExecutionPhase,
  MiddlewareStage,
  AssertionReference,
  TargetOutcome,
  Failure,
  AssertionResult,
  GroupMiddlewareFailure,
} from '@hanamaru/execution-protocol/data'
import type { ResourceScope } from '@hanamaru/blueprint/model'

import type { SourceLocation } from '@hanamaru/blueprint/model'

import type { ResolvedExecutionConfig } from '../execution/config.js'

interface AttemptResultBase {
  readonly attempt: number
  readonly durationMs: number
  readonly outcome: TargetOutcome | null
}

export type PassedAttemptResult = AttemptResultBase & {
  readonly status: 'passed'
  readonly assertions: readonly Extract<AssertionResult, { status: 'passed' }>[]
  readonly failures: readonly []
  readonly cleanup: 'complete'
}

export type FailedAttemptResult = AttemptResultBase & {
  readonly status: 'failed'
  readonly assertions: readonly AssertionResult[]
  readonly failures: readonly [Failure, ...Failure[]]
  readonly cleanup: 'complete' | 'incomplete'
}

export type CancelledAttemptResult = AttemptResultBase & {
  readonly status: 'cancelled'
  readonly assertions: readonly Extract<AssertionResult, { status: 'passed' | 'not-evaluated' }>[]
  readonly failures: readonly []
  readonly cleanup: 'complete' | 'incomplete'
}

export type AttemptResult = PassedAttemptResult | FailedAttemptResult | CancelledAttemptResult

type RetriableFailedAttemptResult = FailedAttemptResult & { readonly cleanup: 'complete' }

export type CaseResult = {
  readonly name: string
  readonly origin: SourceLocation
  readonly path: readonly number[]
  readonly row: { readonly index: number; readonly value: DiagnosticValue } | null
  readonly config: ResolvedExecutionConfig
  readonly durationMs: number
} & (
  | { readonly attempts: readonly [...RetriableFailedAttemptResult[], PassedAttemptResult]; readonly notRun?: never }
  | { readonly attempts: readonly [...RetriableFailedAttemptResult[], FailedAttemptResult]; readonly notRun?: never }
  | { readonly attempts: readonly [...RetriableFailedAttemptResult[], CancelledAttemptResult]; readonly notRun?: never }
  | { readonly attempts: readonly []; readonly notRun: 'skipped' | 'todo' | 'cancelled' }
)

export interface TestResult {
  readonly kind: 'test'
  readonly name: string
  readonly path: readonly number[]
  readonly source?: { readonly file: string; readonly projects: readonly string[] }
  readonly cases: readonly CaseResult[]
}

export type GroupMiddlewareResult =
  | {
      readonly status: 'passed'
      readonly durationMs: number
      readonly failures: readonly []
      readonly cleanup: 'complete'
    }
  | {
      readonly status: 'failed'
      readonly durationMs: number
      readonly failures: readonly [GroupMiddlewareFailure, ...GroupMiddlewareFailure[]]
      readonly cleanup: 'complete' | 'incomplete'
    }
  | {
      readonly status: 'cancelled'
      readonly durationMs: number
      readonly failures: readonly []
      readonly cleanup: 'complete' | 'incomplete'
    }
  | {
      readonly status: 'not-run'
      readonly reason: 'no-runnable-cases' | 'cancelled'
      readonly durationMs: 0
      readonly failures: readonly []
      readonly cleanup: 'complete'
    }

export interface GroupResult {
  readonly kind: 'group'
  readonly name: string | null
  readonly origin: SourceLocation
  readonly middleware: GroupMiddlewareResult | null
  readonly path: readonly number[]
  readonly source?: { readonly file: string; readonly projects: readonly string[] }
  readonly children: readonly {
    readonly origin: SourceLocation
    readonly result: TestResult | GroupResult
  }[]
}

export interface ResourceResult {
  readonly id: number
  readonly name: string
  readonly scope: ResourceScope
  readonly middleware: GroupMiddlewareResult
}

interface RunResultBase {
  readonly resources?: readonly ResourceResult[]
  readonly version: 1
  readonly tests: readonly (TestResult | GroupResult)[]
}

export type RunResult = RunResultBase &
  (
    | { readonly status: 'passed'; readonly reason: 'completed' }
    | { readonly status: 'failed'; readonly reason: 'completed' | 'timeout' | 'interrupted' | 'cleanup-failed' }
    | { readonly status: 'cancelled'; readonly reason: 'interrupted' }
  )
