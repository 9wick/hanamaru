import type { ResourceScope } from '../../domain/definition/resource.js'
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
import { required } from '../../foundation/value.js'
import { failure } from './assertions.js'
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
export function progressOf(active: ActiveExecution, phase: ExecutionPhase | null, reason: Reason): Progress {
  if (active.kind === 'attempt') {
    const { base, attempts, number, started, timeoutMs } = active
    return {
      kind: 'case',
      result: {
        ...base,
        durationMs: now() - started,
        attempts: [
          ...attempts,
          {
            attempt: number,
            status: reason === 'timeout' ? 'failed' : 'cancelled',
            durationMs: now() - started,
            outcome: null,
            assertions: [],
            failures:
              reason === 'timeout'
                ? [
                    failure(
                      'timeout',
                      required(phase, 'no active phase for progress'),
                      `attempt exceeded ${timeoutMs}ms`,
                      { timeoutMs, cleanup: 'incomplete' },
                    ),
                  ]
                : [],
            cleanup: 'incomplete',
          },
        ],
      },
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
