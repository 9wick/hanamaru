/** JSONにも同じ形で出す診断値。id/referenceは一つの診断値の中で対応する。 */
export type DiagnosticKey =
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'symbol'; readonly id: number; readonly description: string | null }

export interface DiagnosticProperty {
  readonly key: DiagnosticKey
  readonly value: DiagnosticValue
}

export type DiagnosticValue =
  | { readonly kind: 'undefined' | 'null' | 'hole' | 'missing' }
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

export type ExecutionPhase =
  | 'prepare'
  | 'compile'
  | 'before'
  | 'target'
  | 'checkpoint'
  | 'observe'
  | 'assert'
  | 'cleanup'

/** middlewareの区間。前処理はnextを呼ぶまで、後処理はnextの完了後。 */
export type MiddlewareStage = 'before' | 'after'

export type ObservationResult = {
  readonly refId: number
  readonly tokenId: number
  readonly evidence: 'real-effect' | 'substitute-effect' | 'call-record'
} & (
  | {
      readonly kind: 'state'
      readonly args: readonly DiagnosticValue[]
      readonly timing:
        | { readonly kind: 'before' }
        | { readonly kind: 'after-plan'; readonly wait?: { readonly withinMs: number; readonly intervalMs: number } }
        | { readonly kind: 'after-step'; readonly operationIndex: number }
    }
  | {
      readonly kind: 'action'
      readonly window: { readonly kind: 'settled' } | { readonly kind: 'after'; readonly milliseconds: number }
    }
)

export interface AssertionReference {
  readonly observations?: readonly ObservationResult[]
  readonly adapterType?: DiagnosticValue
  readonly errorTypes?: readonly DiagnosticValue[]
  readonly operationIndex?: number
  readonly index: number
  readonly source: 'expect'
  readonly subject: 'result' | 'error' | 'state' | 'action' | 'property' | 'outcome'
  readonly matcher: 'toEqual' | 'toBe' | 'toBeCloseTo' | 'satisfies' | 'unchanged' | 'count'
  readonly path?: readonly (string | number)[]
  readonly evidence?: 'real-effect' | 'substitute-effect' | 'call-record'
}

export interface TargetOutcome {
  readonly kind: 'return' | 'throw'
  readonly value: DiagnosticValue
}

export type Failure = {
  readonly message: string
} & (
  | {
      readonly kind: 'assertion'
      readonly phase: 'assert'
      readonly assertion: AssertionReference
      readonly expected: DiagnosticValue
      readonly actual: DiagnosticValue
    }
  | {
      readonly kind: 'outcome'
      readonly operationIndex?: number
      readonly phase: 'target'
      readonly expected: 'return' | 'throw'
      readonly actual: TargetOutcome
    }
  | {
      readonly kind: 'observation'
      readonly phase: ExecutionPhase
      readonly observation: ObservationResult
      readonly stage: 'before' | 'after' | 'open' | 'finish' | 'dispose'
      readonly cause: DiagnosticValue
      readonly assertion?: AssertionReference
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
  readonly failureIndexes: readonly number[]
  readonly assertion: AssertionReference
} & (
  | { readonly status: 'passed'; readonly expected: DiagnosticValue; readonly actual: DiagnosticValue }
  | { readonly status: 'failed'; readonly expected: DiagnosticValue; readonly actual: DiagnosticValue }
  | { readonly status: 'not-evaluated'; readonly reason: string; readonly pending?: true }
)

export type GroupMiddlewareFailure = {
  readonly message: string
  readonly phase: MiddlewareStage | 'contract'
} & (
  | { readonly kind: 'execution'; readonly cause: DiagnosticValue }
  | { readonly kind: 'timeout'; readonly timeoutMs: number }
)

export type Reason = 'timeout' | 'interrupted' | 'cleanup-failed'

export type OperationResult = {
  readonly failureIndexes: readonly number[]
  readonly index: number
  readonly key: string
  readonly mode: 'return-required' | 'final'
} & (
  | { readonly status: 'returned'; readonly args: readonly DiagnosticValue[]; readonly value: DiagnosticValue }
  | { readonly status: 'threw'; readonly args: readonly DiagnosticValue[]; readonly value: DiagnosticValue }
  | { readonly status: 'not-run'; readonly reason: string }
  | { readonly status: 'incomplete'; readonly args: readonly DiagnosticValue[]; readonly reason: string }
)

export interface EvaluationResult {
  readonly kind: 'example' | 'generated' | 'shrink'
  readonly sampleIndex: number | null
  readonly input: DiagnosticValue
  readonly operations: readonly OperationResult[]
  readonly expectedTermination: 'return' | 'throw' | 'return-or-throw' | null
  readonly terminationTarget: number | null
  readonly status: 'passed' | 'failed' | 'cancelled'
  readonly outcome: TargetOutcome | null
  readonly assertions: readonly AssertionResult[]
  readonly failureIndexes: readonly number[]
  readonly cleanup: 'complete' | 'incomplete'
}
export interface PropertyRun {
  readonly source: DiagnosticValue
  readonly classification: 'fixed' | 'generated'
  readonly seed: number
  readonly version: number
  readonly runs: number
  readonly maxShrinks: number
  readonly originalCounterexample: DiagnosticValue | null
  readonly counterexample: DiagnosticValue | null
  readonly shrinkPath: readonly number[]
  readonly stopped: 'completed' | 'counterexample' | 'max-shrinks' | 'execution-failed' | 'interrupted'
}
export interface MutableAttempt {
  selectedEvaluationIndex?: number
  evaluations?: EvaluationResult[]
  operations?: OperationResult[]
  expectedTermination?: 'return' | 'throw' | 'return-or-throw' | null
  terminationTarget?: number | null
  property?: PropertyRun
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
