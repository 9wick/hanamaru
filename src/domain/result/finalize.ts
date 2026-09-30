import { nonempty, required } from '../../foundation/value.js'
import type {
  MutableAttempt,
  MutableCaseResult,
  MutableGroupMiddleware,
  MutableNodeResult,
  MutableRunResult,
} from './mutable.js'
import type {
  AttemptResult,
  CaseResult,
  FailedAttemptResult,
  GroupMiddlewareResult,
  GroupResult,
  RunResult,
  TestResult,
} from './types.js'

function finalizeAttempt(input: MutableAttempt): AttemptResult {
  const { status, failures, assertions, cleanup, ...base } = input
  if (status === 'failed') return { ...base, status, failures: nonempty(failures), assertions, cleanup }
  if (failures.length) throw new TypeError('successful or cancelled attempts cannot contain failures')
  if (status === 'passed') {
    if (cleanup !== 'complete') throw new TypeError('passed attempts require complete cleanup')
    const passed = assertions.map((a) => {
      if (a.status !== 'passed') throw new TypeError('passed attempts require passed assertions')
      return a
    })
    return { ...base, status, failures: [], assertions: passed, cleanup }
  }
  const cancelled = assertions.map((a) => {
    if (a.status === 'failed') throw new TypeError('cancelled attempts cannot contain failed assertions')
    return a
  })
  return { ...base, status, failures: [], assertions: cancelled, cleanup }
}

function finalizeCase(input: MutableCaseResult): CaseResult {
  const { attempts, notRun, ...base } = input
  if (notRun !== undefined) {
    if (attempts.length) throw new TypeError('unexecuted cases cannot contain attempts')
    return { ...base, notRun, attempts: [] }
  }
  const last = finalizeAttempt(required(attempts.at(-1), 'executed cases require an attempt'))
  const retries: (FailedAttemptResult & { readonly cleanup: 'complete' })[] = attempts.slice(0, -1).map((input) => {
    const value = finalizeAttempt(input)
    if (value.status !== 'failed' || value.cleanup !== 'complete')
      throw new TypeError('retries require failed attempts with complete cleanup')
    return { ...value, cleanup: value.cleanup }
  })
  if (last.status === 'passed') return { ...base, attempts: [...retries, last] }
  if (last.status === 'failed') return { ...base, attempts: [...retries, last] }
  return { ...base, attempts: [...retries, last] }
}

function finalizeMiddleware(input: MutableGroupMiddleware): GroupMiddlewareResult {
  const { status, durationMs, failures, cleanup } = input
  if (status === 'failed') return { status, durationMs, failures: nonempty(failures), cleanup }
  if (failures.length) throw new TypeError('successful or unexecuted middleware cannot contain failures')
  if (status === 'cancelled') return { status, durationMs, failures: [], cleanup }
  if (cleanup !== 'complete') throw new TypeError('passed or unexecuted middleware requires complete cleanup')
  if (status === 'passed') return { status, durationMs, failures: [], cleanup }
  if (durationMs !== 0) throw new TypeError('unexecuted middleware must have zero duration')
  return { status, durationMs, failures: [], cleanup, reason: required(input.reason) }
}

function finalizeNode(input: MutableNodeResult): TestResult | GroupResult {
  if (input.kind === 'test') return { ...input, cases: input.cases.map(finalizeCase) }
  return {
    ...input,
    middleware: input.middleware ? finalizeMiddleware(input.middleware) : null,
    children: input.children.map((entry) => ({ ...entry, result: finalizeNode(entry.result) })),
  }
}

export function finalizeRun(input: MutableRunResult): RunResult {
  const tests = input.tests.map(finalizeNode)
  if (input.status === 'passed') {
    if (input.reason !== 'completed') throw new TypeError('passed runs must complete')
    return { version: 1, status: 'passed', reason: 'completed', tests }
  }
  if (input.status === 'cancelled') {
    if (input.reason !== 'interrupted') throw new TypeError('cancelled runs must be interrupted')
    return { version: 1, status: 'cancelled', reason: 'interrupted', tests }
  }
  return { version: 1, status: 'failed', reason: input.reason, tests }
}
