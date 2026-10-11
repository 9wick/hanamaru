import { Injectable, inject } from '@zeltjs/core'
import { plainFields } from '../../domain/execution/callbacks.js'
import type { Fields, RuntimeMiddleware, RuntimeMiddlewareResult } from '@hanamaru/blueprint/model'
import { resultTag } from '@hanamaru/blueprint/model'
import { defaultMiddlewareTimeoutMs } from '../../domain/execution/config.js'
import type { GroupNode } from '../../domain/execution/model.js'
import { diagnostic } from '../../domain/result/diagnostic.js'
import type { MutableGroupMiddleware, Reason } from '../../domain/result/mutable.js'
import type { GroupMiddlewareFailure } from '../../domain/result/types.js'
import { errorMessage } from '../../domain/result/exception.js'
import type { Value } from '../../domain/execution/javascript.js'
import { invoke, required, valueOf } from '../../domain/execution/javascript.js'
import type { GroupReply } from '../ports/executor.js'
import { now } from './clock.js'
import { CaseFailed, CleanupFault, MiddlewareFault } from './faults.js'
import { StageTimer } from './services.js'
import { RunLifecycle } from './lifecycle.js'
import type { Stage } from './state.js'

/** nextを呼ぶまでがbefore、下流の実行中がinside、下流が終わってからがafter。 */
type MiddlewareStage = 'before' | 'inside' | 'after'

/** middlewareがいまどの区間にいるか。afterまで進んだときだけ下流の結末が確定している。 */
type MiddlewareTrace<T> =
  | { readonly stage: 'before' | 'inside' }
  | {
      readonly stage: 'after'
      readonly downstream: { readonly kind: 'value'; readonly value: T } | { readonly kind: 'error'; error: Value }
    }

/** middleware自身の関数が返したか投げたか。 */
type MiddlewareReturn =
  | { readonly kind: 'returned'; readonly token: Value }
  | { readonly kind: 'threw'; readonly error: Value }

/** 投げられた値はnullやundefinedでもありうるため、有無は入れ物の有無で表す。 */
type Thrown = { readonly error: Value } | null

function downstreamError<T>(trace: MiddlewareTrace<T>): Thrown {
  return trace.stage === 'after' && trace.downstream.kind === 'error' ? { error: trace.downstream.error } : null
}

function downstreamValue<T>(trace: MiddlewareTrace<T>): { value: T } | null {
  return trace.stage === 'after' && trace.downstream.kind === 'value' ? { value: trace.downstream.value } : null
}

/**
 * 区間の記録から、middlewareとして投げる例外を決める。問題がなければnull。
 * 期限切れのときは下流と自身の例外を落とさず、後処理の失敗としてまとめて運ぶ。
 */
function middlewareFault<T>(
  trace: MiddlewareTrace<T>,
  returned: MiddlewareReturn,
  overdue: { stage: MiddlewareStage } | null,
  timeoutMs: number,
): Thrown {
  const downstream = downstreamError(trace)
  if (!overdue) return returned.kind === 'threw' ? { error: returned.error } : downstream
  const timeout = new MiddlewareFault(
    new Error('middleware timed out'),
    overdue.stage === 'before' ? 'before' : 'after',
    'timeout',
    timeoutMs,
  )
  const errors: Value[] = []
  if (downstream && !(downstream.error instanceof CaseFailed))
    errors.push(...(downstream.error instanceof CleanupFault ? downstream.error.errors : [downstream.error]))
  // middleware自身の例外は、下流から伝わってきたものと同一でなければ別の失敗として残す。
  const own: Thrown =
    returned.kind === 'threw' && (downstream === null || returned.error !== downstream.error)
      ? { error: returned.error }
      : null
  if (own) errors.push(own.error)
  if (!errors.length) return { error: timeout }
  return {
    error: new CleanupFault(
      [...errors, timeout],
      (downstream?.error instanceof CleanupFault && downstream.error.incomplete) ||
        (downstream?.error instanceof MiddlewareFault &&
          downstream.error.stage === 'after' &&
          downstream.error.kind !== 'timeout') ||
        own !== null,
    ),
  }
}

export async function withMiddleware<T>(
  step: RuntimeMiddleware,
  ctx: Readonly<Fields>,
  body: (fields: Fields) => Promise<T>,
  onTimeout?: () => void,
  onStage?: (stage: Stage, timeoutMs: number) => void,
  cancellation?: AbortSignal,
): Promise<T | undefined> {
  const timeoutMs = step.timeout ?? defaultMiddlewareTimeoutMs
  const timer = new StageTimer<MiddlewareStage>(timeoutMs, 'before', () => onTimeout?.())
  const cancelTimer = () => timer.clear()
  cancellation?.addEventListener('abort', cancelTimer)
  if (cancellation?.aborted) cancelTimer()
  let calls = 0
  let trace: MiddlewareTrace<T> = { stage: 'before' }
  let nextPromise: Promise<RuntimeMiddlewareResult> | undefined
  let nextToken: RuntimeMiddlewareResult | undefined
  onStage?.('before', timeoutMs)
  const next = (fields?: object) => {
    calls++
    if (calls !== 1) throw new MiddlewareFault(new Error('next called more than once'), 'contract')
    timer.clear()
    if (timer.overdue())
      throw new MiddlewareFault(new Error('middleware before timed out'), 'before', 'timeout', timeoutMs)
    trace = { stage: 'inside' }
    // insideは下流の時間なので、middlewareの期限は測らない。
    timer.pause('inside')
    onStage?.('inside', timeoutMs)
    let extra
    try {
      extra = plainFields(fields)
    } catch (error) {
      throw new MiddlewareFault(valueOf(error), 'contract')
    }
    nextPromise = (async () => {
      let downstream: { kind: 'value'; value: T } | { kind: 'error'; error: Value }
      try {
        downstream = { kind: 'value', value: await body(extra) }
      } catch (error) {
        downstream = { kind: 'error', error: valueOf(error) }
      }
      trace = { stage: 'after', downstream }
      timer.restart('after')
      onStage?.('after', timeoutMs)
      if (downstream.kind === 'error') throw downstream.error
      nextToken = { [resultTag]: true, fields: extra }
      return nextToken
    })()
    nextPromise.catch(() => {})
    return nextPromise
  }
  try {
    let returned: MiddlewareReturn
    try {
      returned = { kind: 'returned', token: await invoke(step.run, undefined, [ctx, next]) }
    } catch (error) {
      returned = { kind: 'threw', error: valueOf(error) }
    }
    if (nextPromise && trace.stage === 'inside')
      try {
        await nextPromise
      } catch (error) {
        // 下流ではなく区間の切り替え自体が失敗した場合だけ、ここで結末が決まる。
        if (!downstreamError(trace)) trace = { stage: 'after', downstream: { kind: 'error', error: valueOf(error) } }
      }
    timer.clear()
    const fault = middlewareFault(trace, returned, timer.overdue(), timeoutMs)
    if (fault) throw fault.error
    const completed = downstreamValue(trace)
    if (calls !== 1 || returned.kind !== 'returned' || returned.token !== nextToken || !completed)
      throw new MiddlewareFault(new Error('middleware must return its next result'), 'contract')
    return completed.value
  } catch (error) {
    const downstream = downstreamError(trace)
    if (downstream && error === downstream.error) throw error
    if (error instanceof MiddlewareFault || error instanceof CleanupFault) throw error
    if (downstream) throw new CleanupFault([downstream.error, valueOf(error)])
    throw new MiddlewareFault(valueOf(error), trace.stage === 'inside' ? 'after' : trace.stage)
  } finally {
    cancellation?.removeEventListener('abort', cancelTimer)
    timer.clear()
    onStage?.('end', timeoutMs)
  }
}

export function failChildren() {
  throw new CaseFailed()
}

function passedMiddleware(durationMs: number): MutableGroupMiddleware {
  return { status: 'passed', durationMs, failures: [], cleanup: 'complete' }
}

/** group middlewareの例外を、報告する結果とrunを打ち切る理由へ翻訳する。打ち切らないならabortはnull。 */
export function groupMiddlewareOutcome(
  error: Value,
  durationMs: number,
): { middleware: MutableGroupMiddleware; abort: Reason | null } {
  // 子のcaseが失敗しただけなら、middleware自身は成功している。
  if (error instanceof CaseFailed) return { middleware: passedMiddleware(durationMs), abort: null }
  const issues = (error instanceof CleanupFault ? error.errors : [error]).filter(
    (issue) => !(issue instanceof CaseFailed),
  )
  const failures = issues.map((issue): GroupMiddlewareFailure =>
    issue instanceof MiddlewareFault
      ? issue.kind === 'timeout'
        ? { kind: 'timeout', phase: issue.stage, message: issue.message, timeoutMs: required(issue.timeoutMs) }
        : { kind: 'execution', phase: issue.stage, message: issue.message, cause: diagnostic(issue.cause) }
      : { kind: 'execution', phase: 'after', message: errorMessage(issue), cause: diagnostic(issue) },
  )
  const cleanup =
    (error instanceof CleanupFault && error.incomplete) ||
    issues.some((issue) => issue instanceof MiddlewareFault && issue.stage === 'after' && issue.kind !== 'timeout')
      ? 'incomplete'
      : 'complete'
  const abort: Reason | null = failures.some((x) => x.kind === 'timeout')
    ? 'timeout'
    : error instanceof CleanupFault || issues.some((x) => x instanceof MiddlewareFault && x.stage === 'after')
      ? 'cleanup-failed'
      : null
  return { middleware: { status: 'failed', durationMs, failures, cleanup }, abort }
}

/**
 * group middlewareで子を囲む。
 * 子の実行と区間の観測は今回の囲みの指定。実行状態はRunLifecycleと共有する。
 */
@Injectable()
export class GroupMiddlewareExecutor {
  readonly #lifecycle: RunLifecycle

  constructor(lifecycle = inject(RunLifecycle)) {
    this.#lifecycle = lifecycle
  }

  async execute(
    node: GroupNode,
    body: (fields: Fields) => Promise<void>,
    onStage: (stage: Stage, timeoutMs: number) => void,
  ): Promise<GroupReply> {
    const lifecycle = this.#lifecycle
    const started = now()
    try {
      await withMiddleware(
        required(node.bp.middleware),
        Object.freeze(node.stable ?? {}),
        body,
        () => {
          lifecycle.timedOut()
        },
        onStage,
      )
      return { middleware: passedMiddleware(now() - started), reason: lifecycle.reason }
    } catch (error) {
      const outcome = groupMiddlewareOutcome(valueOf(error), now() - started)
      if (outcome.abort) lifecycle.abort(outcome.abort)
      return { middleware: outcome.middleware, reason: lifecycle.reason }
    }
  }
}
