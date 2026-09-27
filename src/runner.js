import { equal, matchObject } from './compare.js'
import { diagnostic } from './diagnostic.js'
import { isDefinition, validateAssertion } from './definition.js'
import { configWith, methodValue, middlewareTag, plainFields, positive, resultTag, retryCount } from './shared.js'

const now = () => performance.now()
class CaseFailed extends Error {
  constructor() {
    super('case failed')
  }
}
class MiddlewareFault extends Error {
  constructor(cause, stage, kind = 'execution', timeoutMs = undefined) {
    super(kind === 'timeout' ? `middleware ${stage} exceeded ${timeoutMs}ms` : `middleware ${stage} failed`)
    this.cause = cause
    this.stage = stage
    this.kind = kind
    this.timeoutMs = timeoutMs
  }
}
class CleanupFault extends Error {
  constructor(errors) {
    super('cleanup failed')
    this.errors = errors
  }
}
function validConfig(config) {
  if (!config || typeof config !== 'object') throw new TypeError('invalid execution config')
  if (config.timeout !== undefined) positive(config.timeout, 'timeout')
  if (config.retry !== undefined) retryCount(config.retry)
}
function validOrigin(origin) {
  if (
    !origin ||
    typeof origin.file !== 'string' ||
    !Number.isSafeInteger(origin.line) ||
    origin.line < 1 ||
    !Number.isSafeInteger(origin.column) ||
    origin.column < 1
  )
    throw new TypeError('invalid source location')
}
function validBehavior(value) {
  if (!value || typeof value !== 'object') throw new TypeError('invalid mock behavior')
  if (value.kind === 'sequence') {
    if (!Array.isArray(value.once) || !value.once.length) throw new TypeError('empty mock sequence')
    value.once.forEach(validBehavior)
    validBehavior(value.fallback)
    if (value.fallback.kind === 'sequence') throw new TypeError('nested mock sequence')
  } else if (!['returns', 'resolves', 'throws', 'rejects', 'callsFake'].includes(value.kind))
    throw new TypeError('invalid mock action')
  else if (value.kind === 'callsFake' && typeof value.fn !== 'function') throw new TypeError('invalid mock fake')
}
function validMocks(mocks) {
  if (!Array.isArray(mocks)) throw new TypeError('invalid mocks')
  for (const mock of mocks) {
    if (!mock || typeof mock.key !== 'string') throw new TypeError('invalid mock target')
    methodValue(mock.object, mock.key)
    validBehavior(mock.behavior)
  }
}
function validCalls(calls) {
  if (!Array.isArray(calls)) throw new TypeError('invalid call conditions')
  for (const call of calls) {
    if (!validateAssertion(call) || call.subject !== 'call' || typeof call.key !== 'string')
      throw new TypeError('invalid call condition')
    methodValue(call.object, call.key)
    if (call.check.matcher === 'calledNthWith' && (!Number.isSafeInteger(call.check.n) || call.check.n < 1))
      throw new TypeError('invalid call index')
    if (call.check.matcher === 'calledTimes' && (!Number.isSafeInteger(call.check.count) || call.check.count < 0))
      throw new TypeError('invalid call count')
  }
}
function validateBlueprint(bp, ancestors = new Set()) {
  if (!bp || typeof bp !== 'object' || bp.version !== 1 || !['test', 'group', 'definition'].includes(bp.kind))
    throw new TypeError('invalid blueprint')
  if (ancestors.has(bp)) throw new TypeError('cyclic blueprint')
  ancestors.add(bp)
  validConfig(bp.config)
  validMocks(bp.mocks)
  if (
    !Array.isArray(bp.steps) ||
    bp.steps.some((step) => step?.[middlewareTag] !== true || typeof step.run !== 'function')
  )
    throw new TypeError('invalid middleware steps')
  bp.steps.forEach((step) => step.timeout === undefined || positive(step.timeout, 'middleware timeout'))
  if (bp.kind === 'test') {
    if (!bp.target || typeof bp.target.fn !== 'function' || !Array.isArray(bp.cases) || !bp.cases.length)
      throw new TypeError('invalid test blueprint')
    for (const item of bp.cases) {
      validOrigin(item.origin)
      validConfig(item.config)
      if (!['run', 'only', 'skip', 'todo'].includes(item.mode)) throw new TypeError('invalid case mode')
      if (item.mode !== 'todo') {
        validMocks(item.mocks)
        validCalls(item.calls)
        if (
          !item.args ||
          !['value', 'from-context'].includes(item.args.kind) ||
          (item.args.kind === 'from-context' && typeof item.args.build !== 'function')
        )
          throw new TypeError('invalid case args')
        if (!item.expect && !item.calls.length) throw new TypeError('case has no expectation')
      }
    }
  } else {
    if (!Array.isArray(bp.children) || !bp.children.length) throw new TypeError('empty blueprint children')
    if (bp.kind === 'group') {
      validOrigin(bp.origin)
      if (
        bp.middleware !== null &&
        (bp.middleware?.[middlewareTag] !== true || typeof bp.middleware.run !== 'function')
      )
        throw new TypeError('invalid group middleware')
      if (bp.middleware?.timeout !== undefined) positive(bp.middleware.timeout, 'middleware timeout')
    }
    for (const entry of bp.children) {
      if (bp.kind === 'group') {
        validOrigin(entry.origin)
        validateBlueprint(entry.blueprint, ancestors)
      } else validateBlueprint(entry, ancestors)
    }
  }
  ancestors.delete(bp)
}
function overlayMocks(base, own) {
  const merged = [...base]
  for (const mock of own) {
    const index = merged.findIndex((x) => x.object === mock.object && x.key === mock.key)
    if (index < 0) merged.push(mock)
    else merged[index] = mock
  }
  return merged
}
function expand(bp, config, mocks, frames, entryOrigin) {
  const settings = configWith(config, bp.config)
  const currentMocks = overlayMocks(mocks, bp.mocks)
  const currentFrames = [...frames, { steps: bp.steps, fields: {} }]
  if (bp.kind === 'definition')
    return bp.children.flatMap((child) => expand(child, settings, currentMocks, currentFrames, entryOrigin))
  if (bp.kind === 'test')
    return [
      {
        kind: 'test',
        bp,
        config: settings,
        mocks: currentMocks,
        frames: currentFrames,
        frameCount: currentFrames.length,
        entryOrigin,
      },
    ]
  const children = bp.children.flatMap((entry) =>
    expand(entry.blueprint, settings, currentMocks, currentFrames, entry.origin),
  )
  return [
    {
      kind: 'group',
      bp,
      children,
      config: settings,
      mocks: currentMocks,
      frames: currentFrames,
      frameCount: currentFrames.length,
      entryOrigin,
    },
  ]
}
function allCases(nodes) {
  return nodes.flatMap((node) => (node.kind === 'test' ? node.bp.cases : allCases(node.children)))
}
function filterNodes(nodes, text) {
  return nodes.flatMap((node, originalIndex) => {
    if (node.kind === 'test') {
      const cases = node.bp.cases.flatMap((item, index) =>
        item.name.includes(text) ? [{ ...item, originalIndex: index }] : [],
      )
      return cases.length ? [{ ...node, originalIndex, bp: { ...node.bp, cases } }] : []
    }
    const children = filterNodes(node.children, text)
    return children.length ? [{ ...node, originalIndex, children }] : []
  })
}
function callReference(condition, index) {
  return { index, source: 'expectCalls', subject: 'call', key: condition.key, matcher: condition.check.matcher }
}
function expectationReference(condition, index) {
  return { index, source: 'expect', subject: condition.subject, matcher: condition.check.matcher }
}
function failure(kind, phase, message, more) {
  return { kind, phase, message, ...more }
}
function executableMode(item, only) {
  if (item.mode === 'todo') return 'todo'
  if (item.mode === 'skip' || (only && item.mode !== 'only')) return 'skipped'
  return null
}
function cancelledTree(node, path, only) {
  if (node.kind === 'test')
    return {
      kind: 'test',
      name: node.bp.name,
      path,
      cases: node.bp.cases.map((item, index) => ({
        name: item.name,
        origin: item.origin,
        path: [...path, item.originalIndex ?? index],
        row: item.row ? { index: item.row.index, value: diagnostic(item.row.value) } : null,
        config: configWith(node.config, item.config),
        durationMs: 0,
        attempts: [],
        notRun: executableMode(item, only) ?? 'cancelled',
      })),
    }
  return {
    kind: 'group',
    name: node.bp.name,
    origin: node.bp.origin,
    middleware: node.bp.middleware
      ? { status: 'not-run', reason: 'cancelled', durationMs: 0, failures: [], cleanup: 'complete' }
      : null,
    path,
    children: node.children.map((child, index) => ({
      origin: child.entryOrigin,
      result: cancelledTree(child, [...path, child.originalIndex ?? index], only),
    })),
  }
}
async function withMiddleware(step, ctx, body, onTimeout, onStage) {
  let calls = 0
  let stage = 'before'
  let downstreamError,
    hasDownstreamError = false
  let innerResult, nextPromise, nextToken
  let timedOut = false
  const timeoutMs = step.timeout ?? 10_000
  let timer = setTimeout(() => {
    timedOut = true
    onTimeout?.()
  }, timeoutMs)
  const start = now()
  onStage?.('before', timeoutMs)
  const next = (fields) => {
    calls++
    if (calls !== 1) throw new MiddlewareFault(new Error('next called more than once'), 'contract')
    clearTimeout(timer)
    if (timedOut || now() - start > timeoutMs)
      throw new MiddlewareFault(new Error('middleware before timed out'), 'before', 'timeout', timeoutMs)
    stage = 'inside'
    onStage?.('inside', timeoutMs)
    let extra
    try {
      extra = plainFields(fields)
    } catch (error) {
      throw new MiddlewareFault(error, 'contract')
    }
    nextPromise = (async () => {
      try {
        innerResult = await body(extra)
      } catch (error) {
        downstreamError = error
        hasDownstreamError = true
        throw error
      }
      stage = 'after'
      timedOut = false
      timer = setTimeout(() => {
        timedOut = true
        onTimeout?.()
      }, timeoutMs)
      onStage?.('after', timeoutMs)
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
      token = await step.run(ctx, next)
    } catch (error) {
      thrown = error
      threw = true
    }
    if (nextPromise && stage === 'inside') {
      try {
        await nextPromise
      } catch (error) {
        if (!hasDownstreamError) {
          downstreamError = error
          hasDownstreamError = true
        }
      }
    }
    clearTimeout(timer)
    if (threw) throw thrown
    if (timedOut || (stage === 'before' && now() - start > timeoutMs))
      throw new MiddlewareFault(
        new Error('middleware timed out'),
        stage === 'before' ? 'before' : 'after',
        'timeout',
        timeoutMs,
      )
    if (hasDownstreamError) throw downstreamError
    if (calls !== 1 || token !== nextToken)
      throw new MiddlewareFault(new Error('middleware must return its next result'), 'contract')
    return innerResult
  } catch (error) {
    clearTimeout(timer)
    if (hasDownstreamError && error === downstreamError) throw error
    if (error instanceof MiddlewareFault) throw error
    if (hasDownstreamError) throw new CleanupFault([downstreamError, error])
    throw new MiddlewareFault(error, stage === 'inside' ? 'after' : stage)
  } finally {
    onStage?.('end', timeoutMs)
  }
}
function executeAction(action, state, thisArg, args) {
  const selected =
    action.kind === 'sequence'
      ? state.index < action.once.length
        ? action.once[state.index++]
        : action.fallback
      : action
  switch (selected.kind) {
    case 'returns':
      return selected.value
    case 'resolves':
      return Promise.resolve(selected.value)
    case 'throws':
      throw selected.error
    case 'rejects':
      return Promise.reject(selected.error)
    case 'callsFake':
      return selected.fn.apply(thisArg, args)
  }
}
function patchMethods(mocks, calls, target) {
  const entries = [...mocks]
  for (const call of calls)
    if (!entries.some((x) => x.object === call.object && x.key === call.key))
      entries.push({ object: call.object, key: call.key, behavior: null })
  if (target.kind === 'method' && entries.some((x) => x.object === target.object && x.key === target.key && x.behavior))
    throw new TypeError('target method cannot be mocked')
  const records = new Map(),
    restore = []
  let recording = true
  try {
    for (const entry of entries) {
      const object = entry.object,
        key = entry.key
      const own = Object.getOwnPropertyDescriptor(object, key)
      const original = methodValue(object, key)
      if (
        typeof original !== 'function' ||
        (own && (!('value' in own) || (!own.configurable && !own.writable))) ||
        (!own && !Object.isExtensible(object))
      )
        throw new TypeError(`method ${key} cannot be instrumented`)
      const state = { index: 0 }
      const history = []
      records.set(object, (records.get(object) ?? new Map()).set(key, history))
      const wrapped = function (...args) {
        if (recording) history.push(args)
        return entry.behavior ? executeAction(entry.behavior, state, this, args) : original.apply(this, args)
      }
      if (own && !own.configurable) {
        object[key] = wrapped
        restore.push(() => {
          object[key] = original
        })
      } else {
        Object.defineProperty(object, key, {
          configurable: true,
          enumerable: own?.enumerable ?? true,
          writable: true,
          value: wrapped,
        })
        restore.push(() => (own ? Object.defineProperty(object, key, own) : Reflect.deleteProperty(object, key)))
      }
    }
  } catch (error) {
    const errors = restoreMethods(restore)
    if (errors.length) throw new CleanupFault([error, ...errors])
    throw error
  }
  return {
    records,
    restore,
    stopRecording: () => {
      recording = false
    },
  }
}
function restoreMethods(actions) {
  const errors = []
  for (const action of [...actions].reverse())
    try {
      if (action() === false) throw new Error('method restoration failed')
    } catch (error) {
      errors.push(error)
    }
  return errors
}
function checkCondition(condition, actual) {
  const c = condition.check
  switch (c.matcher) {
    case 'toBe':
      return Object.is(actual, c.expected)
    case 'toEqual':
      return equal(actual, c.expected)
    case 'toMatchObject':
      return matchObject(actual, c.expected)
    case 'toSatisfy': {
      const result = c.predicate(actual)
      if (result && typeof result.then === 'function') throw new TypeError('toSatisfy predicate must be synchronous')
      return result === true
    }
    case 'toBeInstanceOf':
      return actual instanceof c.ctor
    case 'toThrow':
      if (!(actual instanceof Error)) return false
      return typeof c.message === 'string'
        ? actual.message.includes(c.message)
        : new RegExp(c.message.source, c.message.flags).test(actual.message)
  }
  return false
}
function checkCalls(condition, history) {
  const c = condition.check
  switch (c.matcher) {
    case 'calledTimes':
      return history.length === c.count
    case 'notCalled':
      return history.length === 0
    case 'calledWith':
      return history.some((args) => equal(args, c.args))
    case 'calledOnceWith':
      return history.length === 1 && equal(history[0], c.args)
    case 'calledNthWith':
      return history.length >= c.n && equal(history[c.n - 1], c.args)
  }
  return false
}
function snapshotExpected(condition) {
  const check = condition.check
  if ('expected' in check) return diagnostic(check.expected)
  if ('args' in check) return diagnostic(check.args)
  if ('count' in check) return diagnostic(check.count)
  return diagnostic(check.matcher)
}
function evaluate(item, ctx, outcome, rawValue, records, failures, assertions) {
  let expected = []
  if (item.expect) {
    try {
      expected = item.expect.build(ctx)
      if (
        !Array.isArray(expected) ||
        !expected.length ||
        expected.some((x) => !validateAssertion(x) || !['result', 'error'].includes(x.subject)) ||
        new Set(expected.map((x) => x.subject)).size !== 1
      )
        throw new TypeError('expect must return nonempty result-only or error-only assertions')
    } catch (error) {
      failures.push(failure('execution', 'expect', 'expect failed', { cause: diagnostic(error) }))
      expected = []
    }
  }
  const wanted = expected[0]?.subject === 'error' ? 'throw' : 'return'
  if (outcome.kind !== wanted)
    failures.push(failure('outcome', 'target', 'unexpected target outcome', { expected: wanted, actual: outcome }))
  for (const [index, condition] of expected.entries()) {
    const ref = expectationReference(condition, index)
    if (outcome.kind !== wanted) {
      assertions.push({ assertion: ref, status: 'not-evaluated', reason: 'target outcome mismatch' })
      continue
    }
    try {
      const okay = checkCondition(condition, rawValue)
      const expectedValue = snapshotExpected(condition),
        actualValue = diagnostic(rawValue)
      assertions.push({
        assertion: ref,
        status: okay ? 'passed' : 'failed',
        expected: expectedValue,
        actual: actualValue,
      })
      if (!okay)
        failures.push(
          failure('assertion', 'assertion', 'expectation did not match', {
            assertion: ref,
            expected: expectedValue,
            actual: actualValue,
          }),
        )
    } catch (error) {
      failures.push(
        failure('execution', 'assertion', 'expectation threw', { cause: diagnostic(error), assertion: ref }),
      )
      assertions.push({
        assertion: ref,
        status: 'failed',
        expected: snapshotExpected(condition),
        actual: diagnostic(rawValue),
      })
    }
  }
  for (const [index, condition] of item.calls.entries()) {
    const ref = callReference(condition, index)
    const history = records.get(condition.object)?.get(condition.key) ?? []
    try {
      const okay = checkCalls(condition, history)
      const expectedValue = snapshotExpected(condition),
        actualValue = diagnostic(history)
      assertions.push({
        assertion: ref,
        status: okay ? 'passed' : 'failed',
        expected: expectedValue,
        actual: actualValue,
      })
      if (!okay)
        failures.push(
          failure('assertion', 'assertion', 'call expectation did not match', {
            assertion: ref,
            expected: expectedValue,
            actual: actualValue,
          }),
        )
    } catch (error) {
      failures.push(
        failure('execution', 'assertion', 'call expectation threw', { cause: diagnostic(error), assertion: ref }),
      )
      assertions.push({
        assertion: ref,
        status: 'failed',
        expected: snapshotExpected(condition),
        actual: diagnostic(history),
      })
    }
  }
}
function faultToFailure(error, phase = 'middleware') {
  if (error instanceof MiddlewareFault)
    return error.kind === 'timeout'
      ? failure('timeout', phase, error.message, {
          timeoutMs: error.timeoutMs,
          cleanup: 'complete',
          stage: error.stage,
        })
      : failure('execution', phase, error.message, { cause: diagnostic(error.cause) })
  return failure('execution', phase, String(error?.message ?? error), { cause: diagnostic(error) })
}
async function attempt(node, item, number, state) {
  const started = now()
  const config = configWith(node.config, item.config)
  const failures = [],
    assertions = []
  let outcome = null,
    activePhase = 'middleware',
    timedOut = false,
    timeoutPhase = null,
    cleanup = 'complete',
    retryable = true
  const timer = setTimeout(() => {
    timedOut = true
    timeoutPhase = activePhase
    state.reason = 'timeout'
    if (state.activeAttempt) state.activeAttempt.phase = activePhase
    state.onTimeout?.()
  }, config.timeout)
  let instruments
  const core = async (ctx) => {
    if (timedOut) return
    activePhase = 'instrumentation'
    instruments = patchMethods(overlayMocks(node.mocks, item.mocks), item.calls, node.bp.target)
    let failed = false,
      originalError
    try {
      activePhase = 'args'
      const args = item.args.kind === 'value' ? item.args.value : item.args.build(ctx)
      if (!Array.isArray(args)) throw new TypeError('argsFrom must return an array')
      activePhase = 'target'
      let rawValue
      try {
        const target = node.bp.target
        rawValue = await (target.kind === 'method' ? target.object[target.key](...args) : target.fn(...args))
        outcome = { kind: 'return', value: diagnostic(rawValue) }
      } catch (error) {
        rawValue = error
        outcome = { kind: 'throw', value: diagnostic(error) }
      }
      instruments.stopRecording()
      activePhase = 'expect'
      evaluate(item, ctx, outcome, rawValue, instruments.records, failures, assertions)
      if (failures.length) throw new CaseFailed()
    } catch (error) {
      failed = true
      originalError = error
    }
    activePhase = 'cleanup'
    const errors = restoreMethods(instruments.restore)
    if (errors.length) throw new CleanupFault(failed ? [originalError, ...errors] : errors)
    if (failed) throw originalError
  }
  const runFrame = async (index, ctx) => {
    if (timedOut) return
    if (index === node.frames.length) return core(Object.freeze(ctx))
    const frame = node.frames[index]
    const walkSteps = async (stepIndex, current) => {
      if (stepIndex === frame.steps.length) return runFrame(index + 1, { ...current, ...frame.fields })
      return withMiddleware(
        frame.steps[stepIndex],
        Object.freeze(current),
        (fields) => walkSteps(stepIndex + 1, { ...current, ...fields }),
        state.onTimeout,
      )
    }
    return walkSteps(0, ctx)
  }
  try {
    await runFrame(0, {})
  } catch (error) {
    if (error instanceof CleanupFault) {
      retryable = false
      cleanup = 'incomplete'
      state.reason = state.reason === 'timeout' ? 'timeout' : 'cleanup-failed'
      for (const issue of error.errors)
        if (!(issue instanceof CaseFailed)) failures.push(faultToFailure(issue, 'cleanup'))
    } else if (!(error instanceof CaseFailed)) {
      if (error instanceof MiddlewareFault && error.stage === 'contract') retryable = false
      if (error instanceof MiddlewareFault && error.stage === 'after' && error.kind !== 'timeout') {
        retryable = false
        cleanup = 'incomplete'
        if (state.reason !== 'timeout') state.reason = 'cleanup-failed'
      }
      failures.push(faultToFailure(error, activePhase))
    }
  } finally {
    clearTimeout(timer)
  }
  if (timedOut || now() - started > config.timeout) {
    state.reason = 'timeout'
    failures.push(
      failure('timeout', timeoutPhase ?? activePhase, `attempt exceeded ${config.timeout}ms`, {
        timeoutMs: config.timeout,
        cleanup,
      }),
    )
  }
  if (failures.some((x) => x.kind === 'timeout')) state.reason = 'timeout'
  const result = {
    attempt: number,
    status: failures.length ? 'failed' : state.reason === 'interrupted' ? 'cancelled' : 'passed',
    durationMs: now() - started,
    outcome,
    assertions,
    failures,
    cleanup,
  }
  return { result, retryable }
}
async function runNode(node, path, only, state) {
  if (node.kind === 'test') {
    const cases = []
    for (const [index, item] of node.bp.cases.entries()) {
      const casePath = [...path, item.originalIndex ?? index]
      const base = {
        name: item.name,
        origin: item.origin,
        path: casePath,
        row: item.row ? { index: item.row.index, value: diagnostic(item.row.value) } : null,
        config: configWith(node.config, item.config),
      }
      const mode = executableMode(item, only)
      if (mode || state.reason) {
        const value = { ...base, durationMs: 0, attempts: [], notRun: mode ?? 'cancelled' }
        cases.push(value)
        recordCase(state, value)
        continue
      }
      const started = now(),
        attempts = []
      for (let number = 1; number <= base.config.retry + 1; number++) {
        state.activeAttempt = {
          path: casePath,
          base,
          attempts,
          number,
          started: now(),
          timeoutMs: base.config.timeout,
          phase: 'middleware',
        }
        state.onProgress?.(snapshotRun(state, 'interrupted'))
        state.onDeadline?.({ kind: 'start', timeoutMs: base.config.timeout, result: snapshotRun(state, 'timeout') })
        const { result, retryable } = await attempt(node, item, number, state)
        state.onDeadline?.({ kind: 'end' })
        state.activeAttempt = null
        attempts.push(result)
        if (result.status === 'passed' || state.reason || !retryable) break
      }
      const value = { ...base, durationMs: now() - started, attempts }
      cases.push(value)
      recordCase(state, value)
    }
    const value = { kind: 'test', name: node.bp.name, path, cases }
    recordNode(state, value)
    return value
  }
  const result = { kind: 'group', name: node.bp.name, origin: node.bp.origin, middleware: null, path, children: [] }
  const started = now()
  const executeChildren = async (fields) => {
    const stable = { ...node.stable, ...fields }
    for (const [index, child] of node.children.entries()) {
      const frames = [...node.frames, { steps: [], fields }, ...child.frames.slice(node.frameCount)]
      const prepared = { ...child, stable, frames }
      result.children.push({
        origin: child.entryOrigin,
        result: state.reason
          ? cancelledTree(prepared, [...path, child.originalIndex ?? index], only)
          : await runNode(prepared, [...path, child.originalIndex ?? index], only, state),
      })
    }
    if (
      resultFailed(
        result.children.map((entry) => entry.result),
        false,
      )
    )
      throw new CaseFailed()
  }
  const runnable = allCases([node]).some((item) => !executableMode(item, only))
  if (!runnable) {
    result.middleware = node.bp.middleware
      ? { status: 'not-run', reason: 'no-runnable-cases', durationMs: 0, failures: [], cleanup: 'complete' }
      : null
    await executeChildren({})
    recordNode(state, result)
    return result
  }
  if (!node.bp.middleware || state.reason) {
    if (node.bp.middleware)
      result.middleware = { status: 'not-run', reason: 'cancelled', durationMs: 0, failures: [], cleanup: 'complete' }
    try {
      await executeChildren({})
    } catch (error) {
      if (!(error instanceof CaseFailed)) throw error
    }
    recordNode(state, result)
    return result
  }
  state.activeGroup = { path, stage: 'before', started, timeoutMs: node.bp.middleware.timeout ?? 10_000 }
  try {
    await withMiddleware(
      node.bp.middleware,
      Object.freeze(node.stable ?? {}),
      executeChildren,
      (stage) => {
        state.reason = 'timeout'
        state.activeGroup = { path, stage, started, timeoutMs: node.bp.middleware.timeout ?? 10_000 }
        state.onTimeout?.()
      },
      (stage) => {
        if (stage === 'inside' || stage === 'end') state.onDeadline?.({ kind: 'end' })
        else {
          state.activeGroup = { path, stage, started, timeoutMs: node.bp.middleware.timeout ?? 10_000 }
          state.onDeadline?.({
            kind: 'start',
            timeoutMs: node.bp.middleware.timeout ?? 10_000,
            result: snapshotRun(state, 'timeout'),
          })
        }
      },
    )
    result.middleware = { status: 'passed', durationMs: now() - started, failures: [], cleanup: 'complete' }
  } catch (error) {
    if (error instanceof CaseFailed) {
      result.middleware = { status: 'passed', durationMs: now() - started, failures: [], cleanup: 'complete' }
      state.activeGroup = null
      recordNode(state, result)
      return result
    }
    const issues = (error instanceof CleanupFault ? error.errors : [error]).filter(
      (issue) => !(issue instanceof CaseFailed),
    )
    const failures = issues.map((issue) =>
      issue instanceof MiddlewareFault
        ? {
            kind: issue.kind === 'timeout' ? 'timeout' : 'execution',
            phase: issue.stage,
            message: issue.message,
            ...(issue.kind === 'timeout' ? { timeoutMs: issue.timeoutMs } : { cause: diagnostic(issue.cause) }),
          }
        : { kind: 'execution', phase: 'after', message: String(issue?.message ?? issue), cause: diagnostic(issue) },
    )
    if (failures.some((x) => x.kind === 'timeout')) state.reason = 'timeout'
    else if (error instanceof CleanupFault || issues.some((x) => x.stage === 'after')) state.reason = 'cleanup-failed'
    const cleanup =
      error instanceof CleanupFault ||
      issues.some((issue) => issue instanceof MiddlewareFault && issue.stage === 'after' && issue.kind !== 'timeout')
        ? 'incomplete'
        : 'complete'
    result.middleware = { status: 'failed', durationMs: now() - started, failures, cleanup }
    for (let index = result.children.length; index < node.children.length; index++) {
      const child = node.children[index]
      result.children.push({
        origin: child.entryOrigin,
        result: cancelledTree(child, [...path, child.originalIndex ?? index], only),
      })
    }
  }
  state.activeGroup = null
  recordNode(state, result)
  return result
}
function resultFailed(nodes, failOnFlaky) {
  for (const node of nodes) {
    if (node.kind === 'group') {
      if (
        node.middleware?.status === 'failed' ||
        resultFailed(
          node.children.map((x) => x.result),
          failOnFlaky,
        )
      )
        return true
    } else
      for (const item of node.cases) {
        const last = item.attempts.at(-1)
        if (last?.status === 'failed' || (failOnFlaky && last?.status === 'passed' && item.attempts.length > 1))
          return true
      }
  }
  return false
}
function samePath(left, right) {
  return left.length === right.length && left.every((part, index) => part === right[index])
}
function findNode(nodes, path) {
  for (const node of nodes) {
    if (samePath(node.path, path)) return node
    if (node.kind === 'group') {
      const found = findNode(
        node.children.map((entry) => entry.result),
        path,
      )
      if (found) return found
    }
  }
  return null
}
function recordNode(state, value) {
  const path = value.path
  if (path.length === 1) state.partial[state.partial.findIndex((node) => samePath(node.path, path))] = value
  else {
    const parent = findNode(state.partial, path.slice(0, -1))
    const entry = parent?.children.find((child) => samePath(child.result.path, path))
    if (entry) entry.result = value
  }
  state.onProgress?.(snapshotRun(state, state.reason ?? 'interrupted'))
}
function recordCase(state, value) {
  const parent = findNode(state.partial, value.path.slice(0, -1))
  const index = parent?.cases.findIndex((item) => samePath(item.path, value.path)) ?? -1
  if (index >= 0) parent.cases[index] = value
  state.onProgress?.(snapshotRun(state, state.reason ?? 'interrupted'))
}
function snapshotRun(state, reason) {
  const tests = structuredClone(state.partial)
  if (state.activeAttempt) {
    const { path, base, attempts, number, started, timeoutMs, phase } = state.activeAttempt
    const parent = findNode(tests, path.slice(0, -1))
    const index = parent?.cases.findIndex((item) => samePath(item.path, path)) ?? -1
    if (index >= 0)
      parent.cases[index] = {
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
                    failure('timeout', phase ?? 'target', `attempt exceeded ${timeoutMs}ms`, {
                      timeoutMs,
                      cleanup: 'incomplete',
                    }),
                  ]
                : [],
            cleanup: 'incomplete',
          },
        ],
      }
  } else if (reason === 'timeout' && state.activeGroup) {
    const { path, stage, started, timeoutMs } = state.activeGroup
    const group = findNode(tests, path)
    if (group)
      group.middleware = {
        status: 'failed',
        durationMs: now() - started,
        cleanup: 'incomplete',
        failures: [
          { kind: 'timeout', phase: stage ?? 'before', timeoutMs, message: `group middleware exceeded ${timeoutMs}ms` },
        ],
      }
  }
  return {
    version: 1,
    status: reason === 'timeout' ? 'failed' : resultFailed(tests, false) ? 'failed' : 'cancelled',
    reason,
    tests,
  }
}
let active = false
export async function run(input, options = {}) {
  if (active) throw new TypeError('a run is already active')
  const definitions = Array.isArray(input) ? input : [input]
  if (!definitions.length || definitions.some((x) => !isDefinition(x)))
    throw new TypeError('run requires completed definitions')
  active = true
  try {
    const blueprints = definitions.map((def) => def.blueprint())
    blueprints.forEach((bp) => validateBlueprint(bp))
    const allNodes = blueprints.flatMap((bp) => expand(bp, { timeout: 5_000, retry: 0 }, [], [], null))
    const unfilteredOnly = allCases(allNodes).some((item) => item.mode === 'only')
    if (unfilteredOnly && options.forbidOnly) throw new TypeError('only is forbidden')
    const nodes = options.filter === undefined ? allNodes : filterNodes(allNodes, options.filter)
    if (!nodes.length) throw new TypeError('filter matched no cases')
    const only = allCases(nodes).some((item) => item.mode === 'only')
    const state = {
      reason: options.signal?.aborted ? 'interrupted' : null,
      partial: [],
      activeAttempt: null,
      activeGroup: null,
      onProgress: options.onProgress,
      onDeadline: options.onDeadline,
    }
    state.partial = nodes.map((node, index) => cancelledTree(node, [node.originalIndex ?? index], only))
    state.onProgress?.(snapshotRun(state, 'interrupted'))
    state.onTimeout = () => options.onTimeout?.(snapshotRun(state, 'timeout'))
    const interrupt = () => {
      if (state.reason !== 'timeout') state.reason = 'interrupted'
    }
    options.signal?.addEventListener('abort', interrupt)
    const results = []
    try {
      for (const [index, node] of nodes.entries())
        results.push(
          state.reason
            ? cancelledTree(node, [node.originalIndex ?? index], only)
            : await runNode(node, [node.originalIndex ?? index], only, state),
        )
    } finally {
      options.signal?.removeEventListener('abort', interrupt)
    }
    const failed =
      resultFailed(results, options.failOnFlaky) || state.reason === 'timeout' || state.reason === 'cleanup-failed'
    return {
      version: 1,
      status: failed ? 'failed' : state.reason === 'interrupted' ? 'cancelled' : 'passed',
      reason: state.reason ?? 'completed',
      tests: results,
    }
  } finally {
    active = false
  }
}
