import type { ResolvedCallAssertion } from '../../domain/assertion/runtime.js'
import { methodValue } from '../../domain/definition/operations.js'
import type { Fields, RuntimeCase } from '../../domain/definition/runtime.js'
import { configWith } from '../../domain/execution/config.js'
import type { SuiteNode } from '../../domain/execution/model.js'
import { diagnostic } from '../../domain/result/diagnostic.js'
import type { MutableAttempt } from '../../domain/result/mutable.js'
import type { AssertionResult, ExecutionPhase, Failure, TargetOutcome } from '../../domain/result/types.js'
import { arrayValue, invoke, objectValue, property, valueOf } from '../../foundation/value.js'
import type { AttemptReply } from '../ports/executor.js'
import { callReference, evaluate, failure, faultToFailure } from './assertions.js'
import { now } from './clock.js'
import { CaseFailed, CleanupFault, MiddlewareFault } from './faults.js'
import { patchMethods, restoreMethods } from './instrumentation.js'
import { withMiddleware } from './middleware.js'
import { overlayMocks } from './plan.js'
import type { AttemptServices } from './services.js'

export async function executeAttempt(
  node: SuiteNode,
  item: RuntimeCase,
  number: number,
  services: AttemptServices,
  bindCall: (call: ResolvedCallAssertion) => ResolvedCallAssertion = (call) => call,
): Promise<AttemptReply> {
  const { tracker, events } = services
  const started = now()
  const config = configWith(node.config, item.config)
  const failures: Failure[] = [],
    assertions: AssertionResult[] = []
  let outcome: TargetOutcome | null = null
  let activePhase: ExecutionPhase = 'middleware'
  let timedOut = false
  let timeoutPhase: ExecutionPhase | null = null
  let cleanup: 'complete' | 'incomplete' = 'complete'
  let retryable = true
  const timer = setTimeout(() => {
    timedOut = true
    timeoutPhase = activePhase
    tracker.markPhase(activePhase)
    tracker.abort('timeout')
    events.timedOut()
  }, config.timeout)
  const core = async (ctx: Readonly<Fields>) => {
    if (timedOut) return
    activePhase = 'instrumentation'
    const calls = item.calls.map((condition): ResolvedCallAssertion => {
      const object = condition.object ?? objectValue(invoke(condition.objectFrom, undefined, [ctx]))
      if (condition.objectFrom && property(object, Symbol.toStringTag) === 'Module')
        throw new TypeError('call.from requires a fixture object; use call(namespace, key) for modules')
      const check = condition.check
      const resolved =
        'argsFrom' in check ? { ...check, args: arrayValue(invoke(check.argsFrom, undefined, [ctx])) } : check
      return bindCall({ ...condition, object, check: resolved })
    })
    const instruments = patchMethods(overlayMocks(node.mocks, item.mocks), calls, node.bp.target)
    let failed = false,
      originalError
    try {
      activePhase = 'args'
      const args = item.args.kind === 'value' ? item.args.value : arrayValue(invoke(item.args.build, undefined, [ctx]))
      if (!Array.isArray(args)) throw new TypeError('argsFrom must return an array')
      activePhase = 'target'
      let rawValue
      let outcomeKind: TargetOutcome['kind'] = 'return'
      try {
        const target = node.bp.target
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
      outcome = { kind: outcomeKind, value: diagnostic(rawValue) }
      activePhase = 'expect'
      const evaluated = evaluate({ ...item, calls }, ctx, outcome, rawValue, instruments.records, services.comparison)
      failures.push(...evaluated.failures)
      assertions.push(...evaluated.assertions)
      if (failures.length) throw new CaseFailed()
    } catch (error) {
      failed = true
      originalError = valueOf(error)
    }
    activePhase = 'cleanup'
    const errors = restoreMethods(instruments.restore)
    if (errors.length) throw new CleanupFault(failed ? [originalError, ...errors] : errors)
    if (failed) throw originalError
  }
  const runFrame = async (index: number, ctx: Fields): Promise<void> => {
    if (timedOut) return
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
    if (error instanceof CleanupFault) {
      retryable = false
      cleanup = error.incomplete ? 'incomplete' : 'complete'
      if (tracker.reason !== 'timeout') tracker.abort('cleanup-failed')
      for (const issue of error.errors)
        if (!(issue instanceof CaseFailed)) failures.push(faultToFailure(issue, 'cleanup'))
    } else if (!(error instanceof CaseFailed)) {
      if (error instanceof MiddlewareFault && error.stage === 'contract') retryable = false
      if (error instanceof MiddlewareFault && error.stage === 'after' && error.kind !== 'timeout') {
        retryable = false
        cleanup = 'incomplete'
        if (tracker.reason !== 'timeout') tracker.abort('cleanup-failed')
      }
      failures.push(faultToFailure(error, activePhase))
    }
  } finally {
    clearTimeout(timer)
  }
  if (timedOut || now() - started > config.timeout) {
    tracker.abort('timeout')
    failures.push(
      failure('timeout', timeoutPhase ?? activePhase, `attempt exceeded ${config.timeout}ms`, {
        timeoutMs: config.timeout,
        cleanup,
      }),
    )
  }
  if (failures.some((x) => x.kind === 'timeout')) tracker.abort('timeout')
  for (const [index, condition] of item.calls.entries()) {
    if (!assertions.some((entry) => entry.assertion.source === 'expectCalls' && entry.assertion.index === index))
      assertions.push({
        assertion: callReference(condition, index),
        status: 'not-evaluated',
        reason: 'attempt failed before call verification',
      })
  }
  const result: MutableAttempt = {
    attempt: number,
    status: failures.length ? 'failed' : tracker.reason === 'interrupted' ? 'cancelled' : 'passed',
    durationMs: now() - started,
    outcome,
    assertions,
    failures,
    cleanup,
  }
  return { result, retryable }
}
