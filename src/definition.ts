import type { Middleware, MiddlewareFn, MiddlewareOptions, TestConstructor, AnyFn } from './api.js'
import type {
  RuntimeAssertion,
  RuntimeValueAssertion,
  RuntimeCallAssertion,
  ValueCheck,
  CallCheck,
  RuntimeBehavior,
  RuntimeMock,
  RuntimeMiddleware,
  CaseData,
  DefinitionData,
  RuntimeTarget,
  RuntimeBlueprint,
  RuntimeGroup,
  CaseBlueprint,
  Fields,
} from './internal.js'
import {
  assertionTag,
  behaviorTag,
  definitionTag,
  doneTag,
  location,
  methodValue,
  middlewareTag,
  positive,
  retryCount,
} from './shared.js'

function valueAssertions(subject: 'result' | 'error') {
  const assertion = (check: ValueCheck): RuntimeValueAssertion => ({ [assertionTag]: true, subject, check })
  return {
    toBe: (value: unknown) => assertion({ matcher: 'toBe', expected: value }),
    toEqual: (value: unknown) => assertion({ matcher: 'toEqual', expected: value }),
    toMatchObject: (value: unknown) => assertion({ matcher: 'toMatchObject', expected: value }),
    toSatisfy: (predicate: (value: unknown) => unknown) => assertion({ matcher: 'toSatisfy', predicate }),
    toBeInstanceOf: (ctor: new (...args: never[]) => object) => assertion({ matcher: 'toBeInstanceOf', ctor }),
    toThrow: (message: string | RegExp) => assertion({ matcher: 'toThrow', message }),
  }
}
function callBuilder(object: object, key: string) {
  const item = (check: CallCheck): RuntimeCallAssertion => ({
    [assertionTag]: true,
    subject: 'call',
    check,
    object,
    key,
  })
  return {
    calledTimes: (count: number) => item({ matcher: 'calledTimes', count }),
    notCalled: () => item({ matcher: 'notCalled' }),
    calledWith: (...args: unknown[]) => item({ matcher: 'calledWith', args }),
    calledOnceWith: (...args: unknown[]) => item({ matcher: 'calledOnceWith', args }),
    calledNthWith: (n: number, ...args: unknown[]) => item({ matcher: 'calledNthWith', n, args }),
  }
}
function validateCalls(calls: readonly RuntimeCallAssertion[]): readonly RuntimeCallAssertion[] {
  if (!Array.isArray(calls) || !calls.length || calls.some((x) => x?.[assertionTag] !== true || x.subject !== 'call')) {
    throw new TypeError('expectCalls must return a nonempty array of call assertions')
  }
  for (const item of calls) {
    if (typeof item.key !== 'string') throw new TypeError('call target must be a method')
    methodValue(item.object, item.key)
    if (item.check.matcher === 'calledNthWith' && (!Number.isSafeInteger(item.check.n) || item.check.n < 1))
      throw new TypeError('calledNthWith index must be positive')
    if (item.check.matcher === 'calledTimes' && (!Number.isSafeInteger(item.check.count) || item.check.count < 0))
      throw new TypeError('calledTimes count must be nonnegative')
  }
  return calls
}
interface RuntimeBehaviorBuilder {
  returnsOnce(value: unknown): RuntimeBehaviorBuilder
  resolvesOnce(value: unknown): RuntimeBehaviorBuilder
  throwsOnce(error: unknown): RuntimeBehaviorBuilder
  rejectsOnce(error: unknown): RuntimeBehaviorBuilder
  callsFakeOnce(fn: AnyFn): RuntimeBehaviorBuilder
  returns(value: unknown): RuntimeBehavior
  resolves(value: unknown): RuntimeBehavior
  throws(error: unknown): RuntimeBehavior
  rejects(error: unknown): RuntimeBehavior
  callsFake(fn: AnyFn): RuntimeBehavior
}
function behaviorBuilder(once: import('./api.js').BehaviorAction[] = []): RuntimeBehaviorBuilder {
  const finish = (action: import('./api.js').BehaviorAction): RuntimeBehavior =>
    once.length
      ? {
          [behaviorTag]: true,
          kind: 'sequence',
          once: once as [import('./api.js').BehaviorAction, ...import('./api.js').BehaviorAction[]],
          fallback: action,
        }
      : { [behaviorTag]: true, ...action }
  const add = (action: import('./api.js').BehaviorAction) => behaviorBuilder([...once, action])
  return {
    returnsOnce: (value) => add({ kind: 'returns', value }),
    resolvesOnce: (value) => add({ kind: 'resolves', value }),
    throwsOnce: (error) => add({ kind: 'throws', error }),
    rejectsOnce: (error) => add({ kind: 'rejects', error }),
    callsFakeOnce: (fn) => add({ kind: 'callsFake', fn }),
    returns: (value) => finish({ kind: 'returns', value }),
    resolves: (value) => finish({ kind: 'resolves', value }),
    throws: (error) => finish({ kind: 'throws', error }),
    rejects: (error) => finish({ kind: 'rejects', error }),
    callsFake: (fn) => finish({ kind: 'callsFake', fn }),
  }
}
function createMock(
  object: object,
  key: string,
  def: (builder: RuntimeBehaviorBuilder) => RuntimeBehavior,
): RuntimeMock {
  if (typeof key !== 'string') throw new TypeError('mock target must be a method')
  methodValue(object, key)
  const behavior = def(behaviorBuilder())
  if (behavior?.[behaviorTag] !== true) throw new TypeError('mock builder must return a completed behavior')
  return { object, key, behavior }
}
function mergeMock(mocks: RuntimeMock[], mock: RuntimeMock) {
  const index = mocks.findIndex((item) => item.object === mock.object && item.key === mock.key)
  const copy = [...mocks]
  if (index < 0) copy.push(mock)
  else copy[index] = mock
  return copy
}
export function middleware<C, S extends object>(
  fn: MiddlewareFn<C, S>,
  options: MiddlewareOptions = {},
): Middleware<C, S> {
  if (typeof fn !== 'function') throw new TypeError('middleware requires a function')
  const timeout = options.timeout === undefined ? undefined : positive(options.timeout, 'middleware timeout')
  return Object.freeze({ [middlewareTag]: true, kind: 'middleware', run: fn, timeout }) as unknown as Middleware<C, S>
}

type ExpectBuilder = (e: {
  result: ReturnType<typeof valueAssertions>
  error: ReturnType<typeof valueAssertions>
  ctx: Readonly<Fields>
}) => readonly RuntimeValueAssertion[]
type CaseBody = (builder: CaseBuilder) => CaseBuilder
class CaseBuilder {
  readonly data: CaseData
  readonly [doneTag]?: true
  constructor(data: CaseData) {
    this.data = data
    if (data[doneTag]) this[doneTag] = true
  }
  copy(patch: Partial<CaseData>) {
    return new CaseBuilder({ ...this.data, ...patch })
  }
  timeout(ms: number) {
    return this.copy({ config: { ...this.data.config, timeout: positive(ms, 'timeout') } })
  }
  retry(count: number) {
    return this.copy({ config: { ...this.data.config, retry: retryCount(count) } })
  }
  mock(object: object, key: string, def: (builder: RuntimeBehaviorBuilder) => RuntimeBehavior) {
    return this.copy({ mocks: mergeMock(this.data.mocks, createMock(object, key, def)) })
  }
  args(...args: unknown[]) {
    return this.copy({ args: { kind: 'value', value: args } })
  }
  argsFrom(build: (ctx: Readonly<Fields>) => unknown[]) {
    return this.copy({ args: { kind: 'from-context', build } })
  }
  expect(build: ExpectBuilder) {
    if (this.data.expect) throw new TypeError('expect already set')
    return this.copy({
      [doneTag]: true,
      expect: {
        kind: 'deferred',
        build: (ctx) => build({ result: valueAssertions('result'), error: valueAssertions('error'), ctx }),
      },
    })
  }
  expectCalls(build: (call: typeof callBuilder) => readonly RuntimeCallAssertion[]) {
    if (this.data.calls.length) throw new TypeError('expectCalls already set')
    return this.copy({ [doneTag]: true, calls: validateCalls(build(callBuilder)) })
  }
}

class DefinitionBuilder {
  readonly data: DefinitionData
  readonly [definitionTag]?: true
  constructor(data: DefinitionData | null = null) {
    this.data = data ?? {
      stage: 'base',
      config: {},
      steps: [],
      mocks: [],
      groups: [],
      cases: [],
      target: null,
      name: null,
    }
    if (data?.stage === 'group' || data?.stage === 'suite') this[definitionTag] = true
  }
  copy(patch: Partial<DefinitionData>) {
    return new DefinitionBuilder({ ...this.data, ...patch })
  }
  settingAllowed() {
    if (this.data.stage === 'group' || this.data.stage === 'suite')
      throw new TypeError('common settings are fixed after the first group or case')
  }
  timeout(ms: number) {
    this.settingAllowed()
    return this.copy({ config: { ...this.data.config, timeout: positive(ms, 'timeout') } })
  }
  retry(count: number) {
    this.settingAllowed()
    return this.copy({ config: { ...this.data.config, retry: retryCount(count) } })
  }
  use(step: RuntimeMiddleware) {
    this.settingAllowed()
    if (step?.[middlewareTag] !== true) throw new TypeError('use requires middleware()')
    return this.copy({ steps: [...this.data.steps, step] })
  }
  mock(object: object, key: string, def: (builder: RuntimeBehaviorBuilder) => RuntimeBehavior) {
    this.settingAllowed()
    return this.copy({ mocks: mergeMock(this.data.mocks, createMock(object, key, def)) })
  }
  target(...args: unknown[]) {
    if (this.data.stage !== 'base') throw new TypeError('target already selected')
    let name = null
    if (typeof args[0] === 'string' && args.length > 1) name = args.shift() as string
    let target: RuntimeTarget
    if (args.length === 1 && typeof args[0] === 'function') target = { kind: 'function', fn: args[0] as AnyFn }
    else if (args.length === 2 && args[0] && typeof args[1] === 'string')
      target = { kind: 'method', object: args[0], key: args[1], fn: methodValue(args[0], args[1]) }
    else throw new TypeError('target requires a function or object method')
    return this.copy({
      stage: 'target',
      name: name ?? (target.kind === 'method' ? target.key : target.fn.name || '<anonymous>'),
      target,
    })
  }
  addCase(
    mode: CaseBlueprint['mode'],
    name: string,
    body?: CaseBody,
    row: CaseBlueprint['row'] = null,
    origin = location(),
  ) {
    if (this.data.stage !== 'target' && this.data.stage !== 'suite') throw new TypeError('select target before cases')
    if (typeof name !== 'string') throw new TypeError('case name must be a string')
    let item: CaseBlueprint
    if (mode === 'todo') item = { name, mode, origin, row: null, config: {} }
    else {
      const built = body!(new CaseBuilder({ config: {}, mocks: [], args: null, expect: null, calls: [] }))
      if (
        !(built instanceof CaseBuilder) ||
        !built[doneTag] ||
        !built.data.args ||
        (!built.data.expect && !built.data.calls.length)
      )
        throw new TypeError('case must return args and an expectation')
      item = { name, mode, origin, row, ...built.data, args: built.data.args }
    }
    return this.copy({ stage: 'suite', cases: [...this.data.cases, item] })
  }
  it(name: string, body: CaseBody) {
    return this.addCase('run', name, body)
  }
  only(name: string, body: CaseBody) {
    return this.addCase('only', name, body)
  }
  skip(name: string, body: CaseBody) {
    return this.addCase('skip', name, body)
  }
  todo(name: string) {
    return this.addCase('todo', name)
  }
  each<Row>(
    name: string | ((row: Row) => string),
    rows: readonly Row[],
    body: (builder: CaseBuilder, row: Row) => CaseBuilder,
  ) {
    if (!Array.isArray(rows) || rows.length === 0) throw new TypeError('each requires nonempty rows')
    const origin = location()
    return rows.reduce<DefinitionBuilder>((test, row, index) => {
      const display = typeof name === 'function' ? name(row) : `${name} [${index + 1}]`
      return test.addCase('run', display, (t) => body(t, row), { index, value: row }, origin)
    }, this)
  }
  group(...args: unknown[]) {
    if (this.data.stage !== 'base' && this.data.stage !== 'group') throw new TypeError('group requires a group builder')
    const origin = location()
    let name = null
    if (typeof args[0] === 'string') name = args.shift() as string
    let step: RuntimeMiddleware | null = null
    if (hasTag(args[0], middlewareTag)) step = args.shift() as RuntimeMiddleware
    const [children] = args
    if (
      args.length !== 1 ||
      !Array.isArray(children) ||
      !children.length ||
      children.some((child) => !isDefinition(child))
    )
      throw new TypeError('group requires completed children')
    const group: RuntimeGroup = {
      version: 1,
      kind: 'group',
      name,
      origin,
      middleware: step,
      config: {},
      steps: [],
      mocks: [],
      children: children.map((child) => ({ origin, blueprint: (child as DefinitionBuilder).blueprint() })),
    }
    return this.copy({ stage: 'group', groups: [...this.data.groups, group] })
  }
  blueprint(): RuntimeBlueprint {
    const d = this.data
    if (d.stage === 'suite')
      return {
        version: 1,
        kind: 'test',
        name: d.name!,
        target: d.target!,
        cases: [...d.cases],
        config: { ...d.config },
        steps: [...d.steps],
        mocks: [...d.mocks],
      }
    if (d.stage === 'group')
      return {
        version: 1,
        kind: 'definition',
        config: { ...d.config },
        steps: [...d.steps],
        mocks: [...d.mocks],
        children: [...d.groups],
      }
    throw new TypeError('test definition is incomplete')
  }
}

function hasTag(value: unknown, tag: symbol): boolean {
  return typeof value === 'object' && value !== null && Reflect.get(value, tag) === true
}
export function isDefinition(value: unknown): value is import('./internal.js').RuntimeDefinitionHandle {
  return hasTag(value, definitionTag)
}
export function validateAssertion(value: unknown): value is RuntimeAssertion {
  return hasTag(value, assertionTag)
}
// The implementation retains all stages; the public constructor exposes only the initial stage.
export const Test = DefinitionBuilder as unknown as TestConstructor
