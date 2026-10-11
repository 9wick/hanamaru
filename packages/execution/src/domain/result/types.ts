import type { ResourceScope } from '@hanamaru/blueprint/model'
import type { CallAssertion, ErrorAssertion, ResultAssertion } from '@hanamaru/blueprint/model'
import type { SourceLocation } from '@hanamaru/blueprint/model'
import type { ResolvedExecutionConfig } from '../execution/config.js'

/** JSONにも同じ形で出す診断値。id/referenceは一つの診断値の中で対応する。 */
export type DiagnosticKey =
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'symbol'; readonly id: number; readonly description: string | null }

export interface DiagnosticProperty {
  readonly key: DiagnosticKey
  readonly value: DiagnosticValue
}

export type DiagnosticValue =
  | { readonly kind: 'undefined' | 'null' | 'hole' }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'number'; readonly value: number | 'NaN' | 'Infinity' | '-Infinity' | '-0' }
  | { readonly kind: 'bigint'; readonly value: string }
  | { readonly kind: 'symbol'; readonly id: number; readonly description: string | null }
  | { readonly kind: 'function'; readonly id: number; readonly name: string }
  | {
      readonly kind: 'array'
      readonly id: number
      readonly items: readonly DiagnosticValue[]
      readonly properties: readonly DiagnosticProperty[]
    }
  | {
      readonly kind: 'object'
      readonly id: number
      readonly type: string
      readonly properties: readonly DiagnosticProperty[]
      readonly omitted: readonly string[]
    }
  | { readonly kind: 'date'; readonly id: number; readonly value: string | null }
  | { readonly kind: 'regexp'; readonly id: number; readonly source: string; readonly flags: string }
  | {
      readonly kind: 'map'
      readonly id: number
      readonly entries: readonly (readonly [DiagnosticValue, DiagnosticValue])[]
    }
  | { readonly kind: 'set'; readonly id: number; readonly values: readonly DiagnosticValue[] }
  | { readonly kind: 'reference'; readonly id: number }
  | { readonly kind: 'accessor'; readonly get: boolean; readonly set: boolean }
  | { readonly kind: 'omitted'; readonly reason: string }

export type ExecutionPhase = 'middleware' | 'instrumentation' | 'args' | 'target' | 'expect' | 'assertion' | 'cleanup'

/** middlewareの区間。前処理はnextを呼ぶまで、後処理はnextの完了後。 */
export type MiddlewareStage = 'before' | 'after'

export type AssertionReference = {
  readonly index: number
} & (
  | { readonly source: 'expect'; readonly subject: 'result'; readonly matcher: ResultAssertion['check']['matcher'] }
  | { readonly source: 'expect'; readonly subject: 'error'; readonly matcher: ErrorAssertion['check']['matcher'] }
  | {
      readonly source: 'expectCalls'
      readonly subject: 'call'
      readonly key: string
      readonly matcher: CallAssertion['check']['matcher']
    }
)

export interface TargetOutcome {
  readonly kind: 'return' | 'throw'
  readonly value: DiagnosticValue
}

export type Failure = {
  readonly message: string
} & (
  | {
      readonly kind: 'assertion'
      readonly phase: 'assertion'
      readonly assertion: AssertionReference
      readonly expected: DiagnosticValue
      readonly actual: DiagnosticValue
    }
  | {
      readonly kind: 'outcome'
      readonly phase: 'target'
      readonly expected: 'return' | 'throw'
      readonly actual: TargetOutcome
    }
  | {
      readonly kind: 'execution'
      readonly phase: ExecutionPhase
      readonly cause: DiagnosticValue
      readonly assertion?: AssertionReference
    }
  | {
      readonly kind: 'timeout'
      readonly phase: ExecutionPhase
      readonly timeoutMs: number
      readonly cleanup: 'complete' | 'incomplete'
      readonly stage?: MiddlewareStage
    }
)

export type AssertionResult = {
  readonly assertion: AssertionReference
} & (
  | { readonly status: 'passed'; readonly expected: DiagnosticValue; readonly actual: DiagnosticValue }
  | { readonly status: 'failed'; readonly expected: DiagnosticValue; readonly actual: DiagnosticValue }
  | { readonly status: 'not-evaluated'; readonly reason: string }
)

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

export type GroupMiddlewareFailure = {
  readonly message: string
  readonly phase: MiddlewareStage | 'contract'
} & (
  | { readonly kind: 'execution'; readonly cause: DiagnosticValue }
  | { readonly kind: 'timeout'; readonly timeoutMs: number }
)

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
