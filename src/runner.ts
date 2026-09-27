import type { Value } from './value.js'
import { valueOf, invoke, arrayValue, functionValue, required, property } from './value.js'
import * as v from 'valibot'
import { assertionReferenceSchema, failureSchema } from './schemas.js'
import { finalizeRun } from './result.js'
import type {
  TestDefinition,
  RunOptions,
  RunResult,
  ExecutionConfig,
  SourceLocation,
  BehaviorBlueprint,
  ExecutionPhase,
  AssertionResult,
  AssertionReference,
  Failure,
  TargetOutcome,
  GroupMiddlewareFailure,
} from './api.js'
import type {
  RuntimeBlueprint,
  RuntimeMock,
  RuntimeCallAssertion,
  RuntimeValueAssertion,
  RuntimeAssertion,
  RuntimeTarget,
  RuntimeMiddleware,
  RuntimeCase,
  CaseBlueprint,
  ExecutionNode,
  SuiteNode,
  GroupNode,
  Frame,
  Fields,
  Stage,
  Reason,
  MutableAttempt,
  MutableCaseResult,
  MutableNodeResult,
  MutableGroupResult,
  MutableGroupMiddleware,
  MutableRunResult,
  RunState,
  AttemptState,
  InternalRunOptions,
  Executor,
  Plan,
  AttemptReply,
  GroupReply,
} from './internal.js'
import { errorMessage } from './shared.js'
import { equal, matchObject } from './compare.js'
import { diagnostic } from './diagnostic.js'
import { DefinitionBuilder, isDefinition, validateAssertion, checkedAssertion, checkedCall } from './definition.js'
import { configWith, methodValue, middlewareTag, plainFields, positive, resultTag, retryCount } from './shared.js'

const now = () => performance.now()
class CaseFailed extends Error {
  constructor() {
    super('case failed')
  }
}
class MiddlewareFault extends Error {
  override cause: Value
  stage: 'before' | 'after' | 'contract'
  kind: 'execution' | 'timeout'
  timeoutMs: number | undefined
  constructor(
    cause: Value,
    stage: 'before' | 'after' | 'contract',
    kind: 'execution' | 'timeout' = 'execution',
    timeoutMs?: number,
  ) {
    super(kind === 'timeout' ? `middleware ${stage} exceeded ${timeoutMs}ms` : `middleware ${stage} failed`)
    this.cause = cause
    this.stage = stage
    this.kind = kind
    this.timeoutMs = timeoutMs
  }
}
class CleanupFault extends Error {
  errors: Value[]
  incomplete: boolean
  constructor(errors: Value[], incomplete = true) {
    super('cleanup failed')
    this.errors = errors
    this.incomplete = incomplete
  }
}
function validConfig(config: ExecutionConfig) {
  if (!config || typeof config !== 'object') throw new TypeError('invalid execution config')
  if (config.timeout !== undefined) positive(config.timeout, 'timeout')
  if (config.retry !== undefined) retryCount(config.retry)
}
function validOrigin(origin: SourceLocation) {
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
function validBehavior(value: BehaviorBlueprint) {
  if (!value || typeof value !== 'object') throw new TypeError('invalid mock behavior')
  if (value.kind === 'sequence') {
    if (!Array.isArray(value.once) || !value.once.length) throw new TypeError('empty mock sequence')
    value.once.forEach(validBehavior)
    validBehavior(value.fallback)
    if (property(value.fallback, 'kind') === 'sequence') throw new TypeError('nested mock sequence')
  } else if (!['returns', 'resolves', 'throws', 'rejects', 'callsFake'].includes(value.kind))
    throw new TypeError('invalid mock action')
  else if (value.kind === 'callsFake' && typeof value.fn !== 'function') throw new TypeError('invalid mock fake')
}
function validMocks(mocks: RuntimeMock[]) {
  if (!Array.isArray(mocks)) throw new TypeError('invalid mocks')
  for (const mock of mocks) {
    if (!mock || typeof mock.key !== 'string') throw new TypeError('invalid mock target')
    methodValue(mock.object, mock.key)
    validBehavior(mock.behavior)
  }
}
function validCalls(calls: readonly RuntimeCallAssertion[]) {
  if (!Array.isArray(calls)) throw new TypeError('invalid call conditions')
  for (const call of arrayValue(calls).map(checkedCall)) {
    if (!validateAssertion(call) || call.subject !== 'call' || typeof call.key !== 'string')
      throw new TypeError('invalid call condition')
    methodValue(call.object, call.key)
    if (call.check.matcher === 'calledNthWith' && (!Number.isSafeInteger(call.check.n) || call.check.n < 1))
      throw new TypeError('invalid call index')
    if (call.check.matcher === 'calledTimes' && (!Number.isSafeInteger(call.check.count) || call.check.count < 0))
      throw new TypeError('invalid call count')
  }
}
function validateBlueprint(bp: RuntimeBlueprint, ancestors = new Set<RuntimeBlueprint>()) {
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
    if (bp.kind === 'group')
      for (const entry of bp.children) {
        validOrigin(entry.origin)
        validateBlueprint(entry.blueprint, ancestors)
      }
    else for (const entry of bp.children) validateBlueprint(entry, ancestors)
  }
  ancestors.delete(bp)
}
function overlayMocks(base: RuntimeMock[], own: RuntimeMock[]) {
  const merged = [...base]
  for (const mock of own) {
    const index = merged.findIndex((x) => x.object === mock.object && x.key === mock.key)
    if (index < 0) merged.push(mock)
    else merged[index] = mock
  }
  return merged
}
function expand(
  bp: RuntimeBlueprint,
  config: import('./api.js').ResolvedExecutionConfig,
  mocks: RuntimeMock[],
  frames: Frame[],
  entryOrigin: SourceLocation | null,
): ExecutionNode[] {
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
function allCases(nodes: ExecutionNode[]): CaseBlueprint[] {
  return nodes.flatMap((node) => (node.kind === 'test' ? node.bp.cases : allCases(node.children)))
}
function filterNodes(nodes: ExecutionNode[], text: string): ExecutionNode[] {
  return nodes.flatMap<ExecutionNode>((node, originalIndex) => {
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
function callReference(condition: RuntimeCallAssertion, index: number): AssertionReference {
  return { index, source: 'expectCalls', subject: 'call', key: condition.key, matcher: condition.check.matcher }
}
function expectationReference(condition: RuntimeValueAssertion, index: number): AssertionReference {
  return v.parse(assertionReferenceSchema, {
    index,
    source: 'expect',
    subject: condition.subject,
    matcher: condition.check.matcher,
  })
}
function failure<K extends Failure['kind']>(
  kind: K,
  phase: Extract<Failure, { kind: K }>['phase'],
  message: string,
  more: Omit<Extract<Failure, { kind: K }>, 'kind' | 'phase' | 'message'>,
): Failure {
  return v.parse(failureSchema, { kind, phase, message, ...more })
}
function executableMode(item: CaseBlueprint, only: boolean) {
  if (item.mode === 'todo') return 'todo'
  if (item.mode === 'skip' || (only && item.mode !== 'only')) return 'skipped'
  return null
}
function cancelledTree(node: ExecutionNode, path: number[], only: boolean): MutableNodeResult {
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
      origin: required(child.entryOrigin),
      result: cancelledTree(child, [...path, child.originalIndex ?? index], only),
    })),
  }
}
async function withMiddleware<T>(
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
    nextPromise: Promise<import('./internal.js').RuntimeMiddlewareResult> | undefined,
    nextToken: import('./internal.js').RuntimeMiddlewareResult | undefined
  let timedOut = false
  const timeoutMs = step.timeout ?? 10_000
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
function executeAction(action: BehaviorBlueprint, state: { index: number }, thisArg: Value, args: Value[]): Value {
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
      return invoke(selected.fn, thisArg, args)
  }
}
function patchMethods(mocks: RuntimeMock[], calls: readonly RuntimeCallAssertion[], target: RuntimeTarget) {
  const entries: (Omit<RuntimeMock, 'behavior'> & { behavior: BehaviorBlueprint | null })[] = [...mocks]
  for (const call of arrayValue(calls).map(checkedCall))
    if (!entries.some((x) => x.object === call.object && x.key === call.key))
      entries.push({ object: call.object, key: call.key, behavior: null })
  if (
    target.kind === 'method' &&
    entries.some(
      (x) => (x.object === target.object || x.sourceObject === target.object) && x.key === target.key && x.behavior,
    )
  )
    throw new TypeError('target method cannot be mocked')
  const records = new Map<object, Map<string, Value[][]>>(),
    restore: (() => Value | void)[] = []
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
      const history: Value[][] = []
      records.set(object, (records.get(object) ?? new Map<string, Value[][]>()).set(key, history))
      const wrapped = function (this: Value, ...args: Value[]) {
        if (recording) history.push(args)
        return entry.behavior ? executeAction(entry.behavior, state, this, args) : invoke(original, this, args)
      }
      if (own && !own.configurable) {
        if (!Reflect.set(object, key, wrapped)) throw new TypeError(`method ${key} cannot be instrumented`)
        restore.push(() => Reflect.set(object, key, original))
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
    if (errors.length) throw new CleanupFault([valueOf(error), ...errors])
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
function restoreMethods(actions: (() => Value | void)[]): Value[] {
  const errors: Value[] = []
  for (const action of [...actions].reverse())
    try {
      if (action() === false) throw new Error('method restoration failed')
    } catch (error) {
      errors.push(valueOf(error))
    }
  return errors
}
function checkCondition(condition: RuntimeValueAssertion, actual: Value) {
  const c = condition.check
  switch (c.matcher) {
    case 'toBe':
      return Object.is(actual, c.expected)
    case 'toEqual':
      return equal(actual, c.expected)
    case 'toMatchObject':
      return matchObject(actual, c.expected)
    case 'toSatisfy': {
      const result = invoke(c.predicate, undefined, [actual])
      if (result && typeof property(Object(result), 'then') === 'function')
        throw new TypeError('toSatisfy predicate must be synchronous')
      return result === true
    }
    case 'toBeInstanceOf':
      return actual instanceof functionValue(c.ctor)
    case 'toThrow':
      if (!(actual instanceof Error)) return false
      return typeof c.message === 'string'
        ? actual.message.includes(c.message)
        : new RegExp(c.message.source, c.message.flags).test(actual.message)
  }
  return false
}
function checkCalls(condition: RuntimeCallAssertion, history: Value[][]) {
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
function snapshotExpected(condition: RuntimeAssertion) {
  const check = condition.check
  if ('expected' in check) return diagnostic(check.expected)
  if ('args' in check) return diagnostic(check.args)
  if ('count' in check) return diagnostic(check.count)
  return diagnostic(check.matcher)
}
function evaluate(
  item: RuntimeCase,
  ctx: Readonly<Fields>,
  outcome: TargetOutcome,
  rawValue: Value,
  records: Map<object, Map<string, Value[][]>>,
  failures: Failure[],
  assertions: AssertionResult[],
) {
  let expected: readonly RuntimeValueAssertion[] = []
  if (item.expect) {
    try {
      expected = arrayValue(invoke(item.expect.build, undefined, [ctx])).map(checkedAssertion)
      if (
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
function faultToFailure<T>(input: T, phase: ExecutionPhase = 'middleware'): Failure {
  const error = valueOf(input)
  if (error instanceof MiddlewareFault)
    return error.kind === 'timeout'
      ? failure('timeout', phase, error.message, {
          timeoutMs: required(error.timeoutMs),
          cleanup: 'complete',
          ...(error.stage === 'contract' ? {} : { stage: error.stage }),
        })
      : failure('execution', phase, error.message, { cause: diagnostic(error.cause) })
  return failure('execution', phase, errorMessage(error), { cause: diagnostic(error) })
}
export async function executeAttempt(
  node: SuiteNode,
  item: RuntimeCase,
  number: number,
  state: AttemptState,
): Promise<AttemptReply> {
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
    state.reason = 'timeout'
    if (state.activeAttempt) state.activeAttempt.phase = activePhase
    state.onTimeout?.()
  }, config.timeout)
  const core = async (ctx: Readonly<Fields>) => {
    if (timedOut) return
    activePhase = 'instrumentation'
    const instruments = patchMethods(overlayMocks(node.mocks, item.mocks), item.calls, node.bp.target)
    let failed = false,
      originalError
    try {
      activePhase = 'args'
      const args = item.args.kind === 'value' ? item.args.value : arrayValue(invoke(item.args.build, undefined, [ctx]))
      if (!Array.isArray(args)) throw new TypeError('argsFrom must return an array')
      activePhase = 'target'
      let rawValue
      try {
        const target = node.bp.target
        rawValue = valueOf(
          await (target.kind === 'method'
            ? invoke(methodValue(target.object, target.key), target.object, args)
            : invoke(target.fn, undefined, args)),
        )
        outcome = { kind: 'return', value: diagnostic(rawValue) }
      } catch (error) {
        rawValue = valueOf(error)
        outcome = { kind: 'throw', value: diagnostic(error) }
      }
      instruments.stopRecording()
      activePhase = 'expect'
      evaluate(item, ctx, outcome, rawValue, instruments.records, failures, assertions)
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
      cleanup = error.incomplete ? 'incomplete' : 'complete'
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
  const result: MutableAttempt = {
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
async function runNode(
  node: ExecutionNode,
  path: number[],
  only: boolean,
  state: RunState,
): Promise<MutableNodeResult> {
  if (node.kind === 'test') {
    const cases: MutableCaseResult[] = []
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
      if (item.mode === 'todo' || mode || state.reason) {
        const value: MutableCaseResult = { ...base, durationMs: 0, attempts: [], notRun: mode ?? 'cancelled' }
        cases.push(value)
        recordCase(state, value)
        continue
      }
      const started = now(),
        attempts: MutableAttempt[] = []
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
        const { result, retryable } = state.executor
          ? await state.executor.attempt(casePath, number)
          : await executeAttempt(node, item, number, state)
        state.onDeadline?.({ kind: 'end' })
        state.activeAttempt = null
        attempts.push(result)
        if (result.status === 'passed' || state.reason || !retryable) break
      }
      const value = { ...base, durationMs: now() - started, attempts }
      cases.push(value)
      recordCase(state, value)
    }
    const value: MutableNodeResult = { kind: 'test', name: node.bp.name, path, cases }
    recordNode(state, value)
    return value
  }
  const result: MutableGroupResult = {
    kind: 'group',
    name: node.bp.name,
    origin: node.bp.origin,
    middleware: null,
    path,
    children: [],
  }
  const executeChildren = async (fields: Fields) => {
    const stable = { ...node.stable, ...fields }
    for (const [index, child] of node.children.entries()) {
      const frames = [...node.frames, { steps: [], fields }, ...child.frames.slice(node.frameCount)]
      const prepared = { ...child, stable, frames }
      result.children.push({
        origin: required(child.entryOrigin),
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
  const started = now()
  const execution = state.executor
    ? await state.executor.group(path, async () => {
        try {
          await executeChildren({})
          return false
        } catch (error) {
          if (!(error instanceof CaseFailed)) throw error
          return true
        }
      })
    : await executeGroupMiddleware(node, executeChildren, state, (stage) => {
        if (stage === 'inside' || stage === 'end') state.onDeadline?.({ kind: 'end' })
        else {
          state.activeGroup = { path, stage, started, timeoutMs: required(node.bp.middleware).timeout ?? 10_000 }
          state.onDeadline?.({
            kind: 'start',
            timeoutMs: required(node.bp.middleware).timeout ?? 10_000,
            result: snapshotRun(state, 'timeout'),
          })
        }
      })
  result.middleware = execution.middleware
  if (execution.reason) state.reason = execution.reason
  if (result.middleware.status === 'failed') {
    for (let index = result.children.length; index < node.children.length; index++) {
      const child = node.children[index]
      result.children.push({
        origin: required(child.entryOrigin),
        result: cancelledTree(child, [...path, child.originalIndex ?? index], only),
      })
    }
  }
  state.activeGroup = null
  recordNode(state, result)
  return result
}
function resultFailed(nodes: MutableNodeResult[], failOnFlaky = false): boolean {
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
function samePath(left: number[], right: number[]) {
  return left.length === right.length && left.every((part, index) => part === right[index])
}
function findNode(nodes: MutableNodeResult[], path: number[]): MutableNodeResult | null {
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
function recordNode(state: RunState, value: MutableNodeResult) {
  const path = value.path
  if (path.length === 1) state.partial[state.partial.findIndex((node) => samePath(node.path, path))] = value
  else {
    const parent = findNode(state.partial, path.slice(0, -1))
    const entry =
      parent?.kind === 'group' ? parent.children.find((child) => samePath(child.result.path, path)) : undefined
    if (entry) entry.result = value
  }
  state.onProgress?.(snapshotRun(state, state.reason ?? 'interrupted'))
}
function recordCase(state: RunState, value: MutableCaseResult) {
  const parent = findNode(state.partial, value.path.slice(0, -1))
  const index = parent?.kind === 'test' ? parent.cases.findIndex((item) => samePath(item.path, value.path)) : -1
  if (parent?.kind === 'test' && index >= 0) parent.cases[index] = value
  state.onProgress?.(snapshotRun(state, state.reason ?? 'interrupted'))
}
function snapshotRun(state: RunState, reason: Reason): MutableRunResult {
  const tests = structuredClone(state.partial)
  if (state.activeAttempt) {
    const { path, base, attempts, number, started, timeoutMs, phase } = state.activeAttempt
    const parent = findNode(tests, path.slice(0, -1))
    const index = parent?.kind === 'test' ? parent.cases.findIndex((item) => samePath(item.path, path)) : -1
    if (parent?.kind === 'test' && index >= 0)
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
    if (group?.kind === 'group')
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
export function collectBlueprints(input: Value): RuntimeBlueprint[] {
  const definitions = Array.isArray(input) ? arrayValue(input) : [input]
  if (!definitions.length || definitions.some((x) => !isDefinition(x)))
    throw new TypeError('run requires completed definitions')
  const blueprints = definitions.map((def: Value) => {
    if (!isDefinition(def)) throw new TypeError('run requires completed definitions')
    return v.parse(v.instance(DefinitionBuilder), def).blueprint()
  })
  blueprints.forEach((bp) => validateBlueprint(bp))
  return blueprints
}
export function createPlan(blueprints: RuntimeBlueprint[], options: InternalRunOptions = {}): Plan {
  const allNodes = blueprints.flatMap((bp) => expand(bp, { timeout: 5_000, retry: 0 }, [], [], null))
  const unfilteredOnly = allCases(allNodes).some((item) => item.mode === 'only')
  if (unfilteredOnly && options.forbidOnly) throw new TypeError('only is forbidden')
  const nodes = options.filter === undefined ? allNodes : filterNodes(allNodes, options.filter)
  if (!nodes.length) throw new TypeError('filter matched no cases')
  const only = allCases(nodes).some((item) => item.mode === 'only')
  return { blueprints, allNodes, nodes, only }
}
let active = false
export async function run(
  input: TestDefinition | readonly TestDefinition[],
  options: RunOptions = {},
): Promise<RunResult> {
  return finalizeRun(await runActive(() => createPlan(collectBlueprints(input), options), options))
}
export async function runPlan(plan: Plan, options: InternalRunOptions = {}, executor: Executor | null = null) {
  return runActive(() => plan, options, executor)
}
async function runActive(
  buildPlan: () => Plan,
  options: InternalRunOptions,
  executor: Executor | null = null,
): Promise<MutableRunResult> {
  if (active) throw new TypeError('a run is already active')
  active = true
  try {
    const { nodes, only } = buildPlan()
    const state: RunState = {
      reason: options.signal?.aborted ? 'interrupted' : null,
      partial: [],
      activeAttempt: null,
      activeGroup: null,
      onProgress: options.onProgress,
      onDeadline: options.onDeadline,
      executor,
    }
    state.partial = nodes.map((node, index) => cancelledTree(node, [node.originalIndex ?? index], only))
    state.onProgress?.(snapshotRun(state, 'interrupted'))
    state.onTimeout = () => options.onTimeout?.(snapshotRun(state, 'timeout'))
    executor?.attach(state, (reason) => snapshotRun(state, reason))
    const interrupt = () => {
      if (state.reason !== 'timeout') state.reason = 'interrupted'
    }
    options.signal?.addEventListener('abort', interrupt)
    const results: MutableNodeResult[] = []
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
