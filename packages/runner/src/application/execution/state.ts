import { withFailureReferences } from '@hanamaru/execution-protocol'
import type { ResourceScope } from '@hanamaru/blueprint/model'
import type {
  CaseResultBase,
  MutableAttempt,
  MutableCaseResult,
  MutableGroupMiddleware,
  MutableRunResult,
  MutableResourceResult,
  Reason,
} from '../../domain/result/mutable.js'
import type { ExecutionPhase } from '../../domain/result/types.js'
import { required } from '../../domain/execution/javascript.js'
import { failure } from '../../domain/result/failure.js'
import { now } from './clock.js'

export type Progress =
  | { kind: 'resource'; result: MutableResourceResult }
  | { kind: 'init'; result: MutableRunResult }
  | { kind: 'case'; result: MutableCaseResult }
  | { kind: 'group'; path: number[]; middleware: MutableGroupMiddleware | null }

export type Deadline = { kind: 'end' } | { kind: 'start'; timeoutMs: number; progress: Progress }

export type Stage = 'before' | 'inside' | 'after' | 'end' | 'contract'

/** いま実行中の1件。attemptの中の進み具合はphaseとして別に追う。 */
export type ActiveExecution =
  | {
      kind: 'attempt'
      partial?: MutableAttempt
      timeoutPhase?: ExecutionPhase
      base: CaseResultBase
      attempts: MutableAttempt[]
      number: number
      started: number
      timeoutMs: number
    }
  | {
      kind: 'resource'
      id: number
      name: string
      scope: ResourceScope
      stage: 'before' | 'after' | 'contract'
      started: number
      timeoutMs: number
    }
  | { kind: 'group'; path: number[]; stage: 'before' | 'after' | 'contract'; started: number; timeoutMs: number }

/** 実行中の1件を、いま与えられた理由で打ち切った場合の結果として表す。 */
export function progressOf(
  active: ActiveExecution,
  phase: ExecutionPhase | null,
  reason: Reason,
): Exclude<Progress, { kind: 'init' }> {
  if (active.kind === 'attempt') {
    const { base, attempts, number, started, timeoutMs } = active
    const partial = active.partial
    const failures = [...(partial?.failures ?? [])]
    const timeoutIndex = reason === 'timeout' ? failures.length : null
    if (reason === 'timeout')
      failures.push(
        failure(
          'timeout',
          active.timeoutPhase ?? required(phase, 'no active phase for progress'),
          `attempt exceeded ${timeoutMs}ms`,
          {
            timeoutMs,
            cleanup: 'incomplete',
          },
        ),
      )
    const status = failures.length ? 'failed' : 'cancelled'
    const pending = (assertions: MutableAttempt['assertions']) =>
      assertions.map((assertion) =>
        assertion.status === 'not-evaluated' && assertion.pending
          ? { ...assertion, reason: `${reason} before evaluation completed` }
          : assertion,
      )
    const interrupted: MutableAttempt = {
      ...partial,
      attempt: number,
      status,
      durationMs: now() - started,
      outcome: partial?.outcome ?? null,
      assertions: pending(partial?.assertions ?? []),
      failures,
      cleanup: 'incomplete',
      evaluations:
        partial?.evaluations?.map((evaluation) =>
          evaluation.cleanup === 'incomplete'
            ? {
                ...evaluation,
                status,
                assertions: pending([...evaluation.assertions]),
                failureIndexes:
                  timeoutIndex === null ? evaluation.failureIndexes : [...evaluation.failureIndexes, timeoutIndex],
              }
            : evaluation,
        ) ?? [],
      ...(partial?.property
        ? { property: { ...partial.property, stopped: reason === 'timeout' ? 'execution-failed' : 'interrupted' } }
        : {}),
    }
    return {
      kind: 'case',
      result: { ...base, durationMs: now() - started, attempts: [...attempts, withFailureReferences(interrupted)] },
    }
  }

  if (active.kind === 'resource')
    return {
      kind: 'resource',
      result: {
        id: active.id,
        name: active.name,
        scope: active.scope,
        middleware: {
          status: reason === 'timeout' ? 'failed' : 'cancelled',
          durationMs: now() - active.started,
          cleanup: 'incomplete',
          failures:
            reason === 'timeout'
              ? [
                  {
                    kind: 'timeout',
                    phase: active.stage,
                    timeoutMs: active.timeoutMs,
                    message: `resource ${active.name} exceeded ${active.timeoutMs}ms`,
                  },
                ]
              : [],
        },
      },
    }
  return {
    kind: 'group',
    path: active.path,
    middleware: {
      status: reason === 'timeout' ? 'failed' : 'cancelled',
      durationMs: now() - active.started,
      cleanup: 'incomplete',
      failures:
        reason === 'timeout'
          ? [
              {
                kind: 'timeout',
                phase: active.stage,
                timeoutMs: active.timeoutMs,
                message: `group middleware exceeded ${active.timeoutMs}ms`,
              },
            ]
          : [],
    },
  }
}

/** 実行で起きたこと。振る舞いや通知先は持たない。 */
export type RunEvent =
  | { readonly kind: 'initialized' }
  | { readonly kind: 'loading'; readonly file: string; readonly timeout: number }
  | { readonly kind: 'progress'; readonly progress: Progress }
  | { readonly kind: 'deadline'; readonly deadline: Deadline }
  | { readonly kind: 'timeout'; readonly phase: ExecutionPhase | null }
