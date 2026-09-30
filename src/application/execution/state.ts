import type {
  CaseResultBase,
  MutableAttempt,
  MutableCaseResult,
  MutableGroupMiddleware,
  MutableNodeResult,
  MutableRunResult,
  Reason,
} from '../../domain/result/mutable.js'
import type { ExecutionPhase } from '../../domain/result/types.js'
import type { Comparison } from '../ports/comparison.js'
import type { Executor } from '../ports/executor.js'
import type { RunOptions } from './options.js'

export type Progress =
  | { kind: 'init'; result: MutableRunResult }
  | { kind: 'case'; result: MutableCaseResult }
  | { kind: 'group'; path: number[]; middleware: MutableGroupMiddleware | null }

export type Deadline = { kind: 'end' } | { kind: 'start'; timeoutMs: number; progress: Progress }

export type Stage = 'before' | 'inside' | 'after' | 'end' | 'contract'

export interface AttemptState {
  comparison: Comparison
  reason: Reason | null
  activeAttempt: { phase: ExecutionPhase } | null
  onTimeout?: () => void
}

export interface RunState extends AttemptState {
  partial: MutableNodeResult[]
  activeAttempt: {
    phase: ExecutionPhase
    path: number[]
    base: CaseResultBase
    attempts: MutableAttempt[]
    number: number
    started: number
    timeoutMs: number
  } | null
  activeGroup: { path: number[]; stage: 'before' | 'after' | 'contract'; started: number; timeoutMs: number } | null
  onProgress?: (progress: Progress) => void
  onDeadline?: (deadline: Deadline) => void
  executor: Executor | null
}

export interface InternalRunOptions extends RunOptions {
  filter?: string
  signal?: AbortSignal
  onProgress?: (progress: Progress) => void
  onTimeout?: (result: MutableRunResult) => void
  onDeadline?: (deadline: Deadline) => void
}
