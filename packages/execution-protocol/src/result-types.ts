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
  | {
      readonly source: 'expect'
      readonly subject: 'result'
      readonly matcher: 'toBe' | 'toEqual' | 'toMatchObject' | 'toSatisfy'
    }
  | {
      readonly source: 'expect'
      readonly subject: 'error'
      readonly matcher: 'toBeInstanceOf' | 'toThrow' | 'toMatchObject' | 'toSatisfy'
    }
  | {
      readonly source: 'expectCalls'
      readonly subject: 'call'
      readonly key: string
      readonly matcher: 'calledTimes' | 'notCalled' | 'calledWith' | 'calledOnceWith' | 'calledNthWith'
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

export type GroupMiddlewareFailure = {
  readonly message: string
  readonly phase: MiddlewareStage | 'contract'
} & (
  | { readonly kind: 'execution'; readonly cause: DiagnosticValue }
  | { readonly kind: 'timeout'; readonly timeoutMs: number }
)

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

export interface MutableGroupMiddleware {
  status: 'passed' | 'failed' | 'cancelled' | 'not-run'
  durationMs: number
  failures: GroupMiddlewareFailure[]
  cleanup: 'complete' | 'incomplete'
  reason?: 'no-runnable-cases' | 'cancelled'
}
