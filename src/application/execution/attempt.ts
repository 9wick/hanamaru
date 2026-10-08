import { Injectable, inject } from '@zeltjs/core'
import type { ResolvedCallAssertion, RuntimeCallAssertion } from '../../domain/assertion/runtime.js'
import { methodValue } from '../../domain/definition/operations.js'
import type { Fields, RuntimeCase } from '../../domain/definition/runtime.js'
import { configWith } from '../../domain/execution/config.js'
import type { SuiteNode } from '../../domain/execution/model.js'
import { diagnostic } from '../../domain/result/diagnostic.js'
import type { MutableAttempt, Reason } from '../../domain/result/mutable.js'
import type { AssertionResult, ExecutionPhase, Failure, TargetOutcome } from '../../domain/result/types.js'
import type { Value } from '../../foundation/value.js'
import { arrayValue, invoke, objectValue, property, valueOf } from '../../foundation/value.js'
import { Comparison } from '../ports/comparison.js'
import type { AttemptReply } from '../ports/executor.js'
import { callReference, evaluate, failure, faultToFailure } from './assertions.js'
import { now } from './clock.js'
import { CaseFailed, CleanupFault, MiddlewareFault } from './faults.js'
import { MethodPatch } from './instrumentation.js'
import { withMiddleware } from './middleware.js'
import { overlayMocks } from './plan.js'
import { CallBinder, RunEvents, RunTracker, StageTimer } from './services.js'
import { executeInvocations, InvocationFault } from './invocations.js'

/** 1回のattemptが積み上げる観測結果。結果の形に変えるのは最後の1か所だけ。 */
type AttemptRecord = {
  outcome: TargetOutcome | null
  readonly failures: Failure[]
  readonly assertions: AssertionResult[]
  cleanup: 'complete' | 'incomplete'
  retryable: boolean
}

/** 例外をattemptの記録へ翻訳した判定。runを打ち切るかどうかは呼び出し側がtrackerへ渡す。 */
type AttemptFault = {
  readonly failures: readonly Failure[]
  readonly cleanup: 'complete' | 'incomplete'
  readonly retryable: boolean
  readonly abort: Reason | null
}

/** 後処理の失敗は再試行しても直らないため、retryableを落としてrunも打ち切る。 */
function classifyAttemptError(error: Value, phase: ExecutionPhase): AttemptFault {
  if (error instanceof CleanupFault)
    return {
      failures: error.errors
        .filter((issue) => !(issue instanceof CaseFailed))
        .map((issue) => faultToFailure(issue, issue instanceof InvocationFault ? 'target' : 'cleanup')),
      cleanup: error.incomplete ? 'incomplete' : 'complete',
      retryable: false,
      abort: 'cleanup-failed',
    }
  if (error instanceof CaseFailed) return { failures: [], cleanup: 'complete', retryable: true, abort: null }
  if (error instanceof MiddlewareFault && error.stage === 'contract')
    return { failures: [faultToFailure(error, phase)], cleanup: 'complete', retryable: false, abort: null }
  if (error instanceof MiddlewareFault && error.stage === 'after' && error.kind !== 'timeout')
    return {
      failures: [faultToFailure(error, phase)],
      cleanup: 'incomplete',
      retryable: false,
      abort: 'cleanup-failed',
    }
  return {
    failures: [faultToFailure(error, error instanceof InvocationFault ? 'target' : phase)],
    cleanup: 'complete',
    retryable: true,
    abort: null,
  }
}

/** 検証まで届かなかったcall期待は、結果から消さずに未評価として残す。 */
function pendingCallAssertions(
  calls: readonly RuntimeCallAssertion[],
  evaluated: readonly AssertionResult[],
): AssertionResult[] {
  return calls
    .map((condition, index) => ({ condition, index }))
    .filter(
      ({ index }) =>
        !evaluated.some((entry) => entry.assertion.source === 'expectCalls' && entry.assertion.index === index),
    )
    .map(({ condition, index }): AssertionResult => ({
      assertion: callReference(condition, index),
      status: 'not-evaluated',
      reason: 'attempt failed before call verification',
    }))
}

function finalizeAttempt(
  record: AttemptRecord,
  calls: readonly RuntimeCallAssertion[],
  number: number,
  durationMs: number,
  reason: Reason | null,
): MutableAttempt {
  return {
    attempt: number,
    status: record.failures.length ? 'failed' : reason === 'interrupted' ? 'cancelled' : 'passed',
    durationMs,
    outcome: record.outcome,
    assertions: [...record.assertions, ...pendingCallAssertions(calls, record.assertions)],
    failures: record.failures,
    cleanup: record.cleanup,
  }
}

/**
 * 1回のattemptを走らせる。どの節のどのcaseを何回目に走らせるかは、実行ごとの指定として引数で受け取る。
 * call期待の繋ぎ替えと通知の受け取り手は1回のrunに属するため、これも引数で受け取る。
 */
@Injectable()
export class AttemptExecutor {
  readonly #comparison: Comparison
  readonly #tracker: RunTracker

  constructor(comparison = inject(Comparison), tracker = inject(RunTracker)) {
    this.#comparison = comparison
    this.#tracker = tracker
  }

  async execute(
    node: SuiteNode,
    item: RuntimeCase,
    number: number,
    calls: CallBinder,
    events: RunEvents,
  ): Promise<AttemptReply> {
    const tracker = this.#tracker
    const config = configWith(node.config, item.config)
    const started = now()
    const record: AttemptRecord = {
      outcome: null,
      failures: [],
      assertions: [],
      cleanup: 'complete',
      retryable: true,
    }
    const timer = new StageTimer<ExecutionPhase>(config.timeout, 'middleware', (phase) => {
      tracker.markPhase(phase)
      tracker.abort('timeout')
      events.timedOut()
    })
    const core = async (ctx: Readonly<Fields>) => {
      if (timer.expired()) return
      timer.enter('instrumentation')
      const resolvedCalls = item.calls.map((condition): ResolvedCallAssertion => {
        const object = condition.object ?? objectValue(invoke(condition.objectFrom, undefined, [ctx]))
        if (condition.objectFrom && property(object, Symbol.toStringTag) === 'Module')
          throw new TypeError('call.from requires a fixture object; use call(namespace, key) for modules')
        const check = condition.check
        const resolved =
          'argsFrom' in check ? { ...check, args: arrayValue(invoke(check.argsFrom, undefined, [ctx])) } : check
        return calls.bind({ ...condition, object, check: resolved })
      })
      const instruments = new MethodPatch(overlayMocks(node.mocks, item.mocks), resolvedCalls, node.bp.target)
      let failed = false,
        originalError
      try {
        timer.enter('args')
        const args =
          item.args.kind === 'calls'
            ? []
            : item.args.kind === 'value'
              ? item.args.value
              : arrayValue(invoke(item.args.build, undefined, [ctx]))
        if (!Array.isArray(args)) throw new TypeError('argsFrom must return an array')
        timer.enter('target')
        let rawValue
        let outcomeKind: TargetOutcome['kind'] = 'return'
        if (item.args.kind === 'calls') {
          rawValue = (
            await executeInvocations(item.args, node.bp.target, () => !timer.expired() && tracker.reason === null)
          ).value
        } else
          try {
            const target = node.bp.target
            if (target.kind === 'relation') throw new TypeError('relation cases require calls()')
            rawValue = valueOf(
              await (target.kind === 'method'
                ? invoke(methodValue(target.object, target.key), target.object, args)
                : invoke(target.fn, undefined, args)),
            )
          } catch (error) {
            rawValue = valueOf(error)
            outcomeKind = 'throw'
          }
        instruments.stopRecording()
        const outcome: TargetOutcome = { kind: outcomeKind, value: diagnostic(rawValue) }
        record.outcome = outcome
        timer.enter('expect')
        const evaluated = evaluate(
          { ...item, calls: resolvedCalls },
          ctx,
          outcome,
          rawValue,
          instruments.records,
          this.#comparison,
        )
        record.failures.push(...evaluated.failures)
        record.assertions.push(...evaluated.assertions)
        if (record.failures.length) throw new CaseFailed()
      } catch (error) {
        failed = true
        originalError = valueOf(error)
      }
      timer.enter('cleanup')
      const errors = instruments.restore()
      if (errors.length) throw new CleanupFault(failed ? [originalError, ...errors] : errors)
      if (failed) throw originalError
    }
    const runFrame = async (index: number, ctx: Fields): Promise<void> => {
      if (timer.expired()) return
      if (index === node.frames.length) return core(Object.freeze(ctx))
      const frame = node.frames[index]
      const walkSteps = async (stepIndex: number, current: Fields): Promise<void> => {
        if (stepIndex === frame.steps.length) return runFrame(index + 1, { ...current, ...frame.fields })
        return withMiddleware(
          frame.steps[stepIndex],
          Object.freeze(current),
          (fields) => walkSteps(stepIndex + 1, { ...current, ...fields }),
          () => events.timedOut(),
        )
      }
      return walkSteps(0, ctx)
    }
    try {
      await runFrame(0, {})
    } catch (error) {
      const fault = classifyAttemptError(valueOf(error), timer.stage)
      record.failures.push(...fault.failures)
      record.cleanup = fault.cleanup
      record.retryable = fault.retryable
      // タイムアウトはrunを打ち切る理由として強く、後処理の失敗で上書きしない。
      if (fault.abort && tracker.reason !== 'timeout') tracker.abort(fault.abort)
    } finally {
      timer.clear()
    }
    const overdue = timer.overdue()
    if (overdue) {
      tracker.abort('timeout')
      record.failures.push(
        failure('timeout', overdue.stage, `attempt exceeded ${config.timeout}ms`, {
          timeoutMs: config.timeout,
          cleanup: record.cleanup,
        }),
      )
    }
    if (record.failures.some((x) => x.kind === 'timeout')) tracker.abort('timeout')
    return {
      result: finalizeAttempt(record, item.calls, number, now() - started, tracker.reason),
      retryable: record.retryable,
    }
  }
}
