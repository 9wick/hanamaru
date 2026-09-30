import { plainFields } from '../../domain/definition/operations.js'
import type { Fields, RuntimeMiddleware } from '../../domain/definition/runtime.js'
import { resultTag } from '../../domain/definition/tags.js'
import { defaultMiddlewareTimeoutMs } from '../../domain/execution/config.js'
import type { GroupNode } from '../../domain/execution/model.js'
import { diagnostic } from '../../domain/result/diagnostic.js'
import type { MutableGroupMiddleware } from '../../domain/result/mutable.js'
import type { GroupMiddlewareFailure } from '../../domain/result/types.js'
import { errorMessage } from '../../foundation/errors.js'
import type { Value } from '../../foundation/value.js'
import { invoke, required, valueOf } from '../../foundation/value.js'
import type { GroupReply } from '../ports/executor.js'
import { now } from './clock.js'
import { CaseFailed, CleanupFault, MiddlewareFault } from './faults.js'
import type { AttemptState, Stage } from './state.js'

export async function withMiddleware<T>(
  step: RuntimeMiddleware,
  ctx: Readonly<Fields>,
  body: (fields: Fields) => Promise<T>,
  onTimeout?: () => void,
  onStage?: (stage: Stage, timeoutMs: number) => void,
): Promise<T | undefined> {
  let calls = 0
  const stage: { value: 'before' | 'inside' | 'after' } = { value: 'before' }
  let downstreamError: Value,
    hasDownstreamError = false
  let innerResult: T | undefined,
    nextPromise: Promise<import('../../domain/definition/runtime.js').RuntimeMiddlewareResult> | undefined,
    nextToken: import('../../domain/definition/runtime.js').RuntimeMiddlewareResult | undefined
  let timedOut = false
  const timeoutMs = step.timeout ?? defaultMiddlewareTimeoutMs
  let timer = setTimeout(() => {
    timedOut = true
    onTimeout?.()
  }, timeoutMs)
  let stageStarted = now()
  onStage?.('before', timeoutMs)
  const next = (fields?: object) => {
    calls++
    if (calls !== 1) throw new MiddlewareFault(new Error('next called more than once'), 'contract')
    clearTimeout(timer)
    if (timedOut || now() - stageStarted > timeoutMs)
      throw new MiddlewareFault(new Error('middleware before timed out'), 'before', 'timeout', timeoutMs)
    stage.value = 'inside'
    onStage?.('inside', timeoutMs)
    let extra
    try {
      extra = plainFields(fields)
    } catch (error) {
      throw new MiddlewareFault(valueOf(error), 'contract')
    }
    nextPromise = (async () => {
      try {
        innerResult = await body(extra)
      } catch (error) {
        downstreamError = valueOf(error)
        hasDownstreamError = true
        throw error
      } finally {
        stage.value = 'after'
        stageStarted = now()
        timedOut = false
        timer = setTimeout(() => {
          timedOut = true
          onTimeout?.()
        }, timeoutMs)
        onStage?.('after', timeoutMs)
      }
      nextToken = { [resultTag]: true, fields: extra }
      return nextToken
    })()
    nextPromise.catch(() => {})
    return nextPromise
  }
  try {
    let token,
      thrown,
      threw = false
    try {
      token = await invoke(step.run, undefined, [ctx, next])
    } catch (error) {
      thrown = error
      threw = true
    }
    if (nextPromise && stage.value === 'inside') {
      try {
        await nextPromise
      } catch (error) {
        if (!hasDownstreamError) {
          downstreamError = valueOf(error)
          hasDownstreamError = true
        }
      }
    }
    clearTimeout(timer)
    if (timedOut || (stage.value !== 'inside' && now() - stageStarted > timeoutMs)) {
      const timeout = new MiddlewareFault(
        new Error('middleware timed out'),
        stage.value === 'before' ? 'before' : 'after',
        'timeout',
        timeoutMs,
      )
      const errors: Value[] = []
      if (hasDownstreamError && !(downstreamError instanceof CaseFailed))
        errors.push(...(downstreamError instanceof CleanupFault ? downstreamError.errors : [downstreamError]))
      if (threw && (!hasDownstreamError || thrown !== downstreamError)) errors.push(valueOf(thrown))
      if (errors.length)
        throw new CleanupFault(
          [...errors, timeout],
          (downstreamError instanceof CleanupFault && downstreamError.incomplete) ||
            (downstreamError instanceof MiddlewareFault &&
              downstreamError.stage === 'after' &&
              downstreamError.kind !== 'timeout') ||
            (threw && (!hasDownstreamError || thrown !== downstreamError)),
        )
      throw timeout
    }
    if (threw) throw thrown
    if (hasDownstreamError) throw downstreamError
    if (calls !== 1 || token !== nextToken)
      throw new MiddlewareFault(new Error('middleware must return its next result'), 'contract')
    return innerResult
  } catch (error) {
    clearTimeout(timer)
    if (hasDownstreamError && error === downstreamError) throw error
    if (error instanceof MiddlewareFault || error instanceof CleanupFault) throw error
    if (hasDownstreamError) throw new CleanupFault([downstreamError, valueOf(error)])
    throw new MiddlewareFault(valueOf(error), stage.value === 'inside' ? 'after' : stage.value)
  } finally {
    onStage?.('end', timeoutMs)
  }
}

export function failChildren() {
  throw new CaseFailed()
}

export async function executeGroupMiddleware(
  node: GroupNode,
  body: (fields: Fields) => Promise<void>,
  state: AttemptState,
  onStage: (stage: Stage, timeoutMs: number) => void,
): Promise<GroupReply> {
  const started = now()
  let middleware: MutableGroupMiddleware
  try {
    await withMiddleware(
      required(node.bp.middleware),
      Object.freeze(node.stable ?? {}),
      body,
      () => {
        state.reason = 'timeout'
        state.onTimeout?.()
      },
      onStage,
    )
    middleware = { status: 'passed', durationMs: now() - started, failures: [], cleanup: 'complete' }
  } catch (error) {
    if (error instanceof CaseFailed)
      return {
        middleware: { status: 'passed', durationMs: now() - started, failures: [], cleanup: 'complete' },
        reason: state.reason,
      }
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
    if (failures.some((x) => x.kind === 'timeout')) state.reason = 'timeout'
    else if (error instanceof CleanupFault || issues.some((x) => x instanceof MiddlewareFault && x.stage === 'after'))
      state.reason = 'cleanup-failed'
    const cleanup =
      (error instanceof CleanupFault && error.incomplete) ||
      issues.some((issue) => issue instanceof MiddlewareFault && issue.stage === 'after' && issue.kind !== 'timeout')
        ? 'incomplete'
        : 'complete'
    middleware = { status: 'failed', durationMs: now() - started, failures, cleanup }
  }
  return { middleware, reason: state.reason }
}
