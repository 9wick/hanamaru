import * as v from 'valibot'
import { markDefinitionUsed, trackDefinition } from '../../application/collection/tracking.js'
import type {
  CallCheck,
  RuntimeCallAssertion,
  RuntimeValueAssertion,
  ValueCheck,
} from '../../domain/assertion/runtime.js'
import type { Assertions } from '../../domain/assertion/types.js'
import { checkedCall, validateCalls } from '../../domain/assertion/validation.js'
import { methodValue } from '../../domain/definition/operations.js'
import type {
  CaseBlueprint,
  CaseData,
  DefinitionData,
  Fields,
  RuntimeBehavior,
  RuntimeBlueprint,
  RuntimeCase,
  RuntimeGroup,
  RuntimeMiddleware,
  RuntimeMock,
  RuntimeTarget,
} from '../../domain/definition/runtime.js'
import { assertionTag, behaviorTag, definitionTag, doneTag, middlewareTag } from '../../domain/definition/tags.js'
import type { ExtendContext, MiddlewareFn, MiddlewareOptions, SourceLocation } from '../../domain/definition/types.js'
import { checkedBehavior } from '../../domain/definition/validation.js'
import { positive, retryCount } from '../../domain/execution/config.js'
import type { AnyFn, FnKeys, MethodOf } from '../../foundation/functions.js'
import type { Value } from '../../foundation/value.js'
import { arrayValue, functionValue, invoke, nonempty, objectValue, property } from '../../foundation/value.js'
import type {
  CallsBuilder,
  ChildrenPhase,
  CompatibleChildren,
  Expect,
  FirstPhase,
  GroupChildren,
  GroupStage,
  ItArgs,
  ItBuilder,
  ItCalls,
  ItDone,
  ItExpected,
  Middleware,
  MockDef,
  Suite,
  TargetStage,
  TestBuilder,
  TestConstructor,
} from './types.js'

function valueAssertions(subject: 'result' | 'error') {
  const assertion = (check: ValueCheck): RuntimeValueAssertion => ({ [assertionTag]: true, subject, check })
  return {
    toBe: (value: Value) => assertion({ matcher: 'toBe', expected: value }),
    toEqual: (value: Value) => assertion({ matcher: 'toEqual', expected: value }),
    toMatchObject: (value: Value) => assertion({ matcher: 'toMatchObject', expected: value }),
    toSatisfy: (predicate: (value: Value) => Value) => assertion({ matcher: 'toSatisfy', predicate }),
    toBeInstanceOf: (ctor: new (...args: never[]) => object) => assertion({ matcher: 'toBeInstanceOf', ctor }),
    toThrow: (message: string | RegExp) => assertion({ matcher: 'toThrow', message }),
  }
}

function callMatchers(target: { object: object } | { objectFrom: object }, key: string) {
  const item = (check: CallCheck): RuntimeCallAssertion => ({
    [assertionTag]: true,
    subject: 'call',
    check,
    ...target,
    key,
  })
  return {
    calledTimes: (count: number) => item({ matcher: 'calledTimes', count }),
    notCalled: () => item({ matcher: 'notCalled' }),
    calledWith: (...args: Value[]) => item({ matcher: 'calledWith', args }),
    calledOnceWith: (...args: Value[]) => item({ matcher: 'calledOnceWith', args }),
    calledNthWith: (n: number, ...args: Value[]) => item({ matcher: 'calledNthWith', n, args }),
    calledWithFrom: (argsFrom: object) => item({ matcher: 'calledWith', argsFrom }),
    calledOnceWithFrom: (argsFrom: object) => item({ matcher: 'calledOnceWith', argsFrom }),
    calledNthWithFrom: (n: number, argsFrom: object) => item({ matcher: 'calledNthWith', n, argsFrom }),
  }
}

const callBuilder = Object.assign((object: object, key: string) => callMatchers({ object }, key), {
  from: (objectFrom: object, key: string) => callMatchers({ objectFrom }, key),
})

interface RuntimeBehaviorBuilder {
  returnsOnce(value: Value): RuntimeBehaviorBuilder
  resolvesOnce(value: Value): RuntimeBehaviorBuilder
  throwsOnce(error: Value): RuntimeBehaviorBuilder
  rejectsOnce(error: Value): RuntimeBehaviorBuilder
  callsFakeOnce(fn: AnyFn): RuntimeBehaviorBuilder
  returns(value: Value): RuntimeBehavior
  resolves(value: Value): RuntimeBehavior
  throws(error: Value): RuntimeBehavior
  rejects(error: Value): RuntimeBehavior
  callsFake(fn: AnyFn): RuntimeBehavior
}

function behaviorBuilder(
  once: import('../../domain/definition/types.js').BehaviorAction[] = [],
): RuntimeBehaviorBuilder {
  const finish = (action: import('../../domain/definition/types.js').BehaviorAction): RuntimeBehavior =>
    once.length
      ? { [behaviorTag]: true, kind: 'sequence', once: nonempty(once), fallback: action }
      : { [behaviorTag]: true, ...action }
  const add = (action: import('../../domain/definition/types.js').BehaviorAction) => behaviorBuilder([...once, action])
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

function createMock(object: object, key: string, def: object): RuntimeMock {
  if (typeof key !== 'string') throw new TypeError('mock target must be a method')
  methodValue(object, key)
  return { object, key, behavior: checkedBehavior(invoke(def, undefined, [behaviorBuilder()])) }
}

function mergeMock(mocks: RuntimeMock[], mock: RuntimeMock) {
  const copy = [...mocks],
    index = mocks.findIndex((item) => item.object === mock.object && item.key === mock.key)
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
  const value: Middleware<C, S> = { [middlewareTag]: true, kind: 'middleware', run: fn, timeout }
  return Object.freeze(value)
}

class CaseBuilder<F extends AnyFn, C> {
  readonly #data: CaseData
  constructor(data: CaseData) {
    this.#data = data
  }
  get [doneTag](): true {
    if (!this.#data[doneTag]) throw new TypeError('case must return args and an expectation')
    return true
  }
  // DefinitionBuilder は別クラスで #data を読めないため、完成検査と取り出しをここに置く。
  completed(base: {
    name: string
    mode: RuntimeCase['mode']
    origin: SourceLocation
    row: CaseBlueprint['row']
  }): RuntimeCase {
    const d = this.#data
    if (!d[doneTag] || !d.args || (!d.expect && !d.calls.length))
      throw new TypeError('case must return args and an expectation')
    return { ...base, config: d.config, mocks: d.mocks, args: d.args, expect: d.expect, calls: d.calls }
  }
  copy(patch: Partial<CaseData>): CaseBuilder<F, C> {
    return new CaseBuilder({ ...this.#data, ...patch })
  }
  timeout(ms: number) {
    return this.copy({ config: { ...this.#data.config, timeout: positive(ms, 'timeout') } })
  }
  retry(count: number) {
    return this.copy({ config: { ...this.#data.config, retry: retryCount(count) } })
  }
  mock<O extends object, K extends FnKeys<O>>(object: O, key: K, def: MockDef<MethodOf<O, K>>): CaseBuilder<F, C> {
    return this.copy({ mocks: mergeMock(this.#data.mocks, createMock(object, key, def)) })
  }
  args(...args: Parameters<F>): ItArgs<F, C> {
    return this.copy({ args: { kind: 'value', value: arrayValue(args) } })
  }
  argsFrom(build: (ctx: Readonly<C>) => Parameters<F>): ItArgs<F, C> {
    return this.copy({ args: { kind: 'from-context', build } })
  }
  expect(build: (e: Expect<F, C>) => Assertions): ItExpected<C> {
    if (this.#data.expect) throw new TypeError('expect already set')
    return this.copy({
      [doneTag]: true,
      expect: {
        kind: 'deferred',
        build: (ctx: Fields) =>
          invoke(build, undefined, [{ result: valueAssertions('result'), error: valueAssertions('error'), ctx }]),
      },
    })
  }
  expectCalls(build: CallsBuilder<C>): ItCalls<F, C> {
    if (this.#data.calls.length) throw new TypeError('expectCalls already set')
    const calls = arrayValue(invoke(build, undefined, [callBuilder])).map(checkedCall)
    return this.copy({ [doneTag]: true, calls: validateCalls(calls) })
  }
}

export class DefinitionBuilder<R extends object = {}, C extends object = R, F extends AnyFn = AnyFn> {
  readonly #data: DefinitionData
  readonly [definitionTag]?: true
  readonly #location: () => SourceLocation
  constructor(location: () => SourceLocation, data: DefinitionData | null = null) {
    this.#location = location
    this.#data = data ?? {
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
    if (this[definitionTag]) trackDefinition(this, this.#location)
  }
  copy(patch: Partial<DefinitionData>): DefinitionBuilder<R, C, F> {
    const next = new DefinitionBuilder<R, C, F>(this.#location, { ...this.#data, ...patch })
    markDefinitionUsed(this)
    return next
  }
  settingAllowed() {
    if (this.#data.stage === 'group' || this.#data.stage === 'suite')
      throw new TypeError('common settings are fixed after the first group or case')
  }
  timeout(ms: number) {
    this.settingAllowed()
    return this.copy({ config: { ...this.#data.config, timeout: positive(ms, 'timeout') } })
  }
  retry(count: number) {
    this.settingAllowed()
    return this.copy({ config: { ...this.#data.config, retry: retryCount(count) } })
  }
  use<S extends object>(step: Middleware<C, S>): TargetStage<ExtendContext<C, S>, R> {
    this.settingAllowed()
    if (step?.[middlewareTag] !== true) throw new TypeError('use requires middleware()')
    return new DefinitionBuilder<R, ExtendContext<C, S>, F>(this.#location, {
      ...this.#data,
      steps: [...this.#data.steps, step],
    })
  }
  mock<O extends object, K extends FnKeys<O>>(
    object: O,
    key: K,
    def: MockDef<MethodOf<O, K>>,
  ): DefinitionBuilder<R, C, F> {
    this.settingAllowed()
    return this.copy({ mocks: mergeMock(this.#data.mocks, createMock(object, key, def)) })
  }
  target<T extends AnyFn>(fn: T): TestBuilder<T, C, R>
  target<T extends AnyFn>(name: string, fn: T): TestBuilder<T, C, R>
  target<O extends object, K extends FnKeys<O>>(obj: O, key: K): TestBuilder<MethodOf<O, K>, C, R>
  target<O extends object, K extends FnKeys<O>>(name: string, obj: O, key: K): TestBuilder<MethodOf<O, K>, C, R>
  target(...input: Value[]): object {
    if (this.#data.stage !== 'base') throw new TypeError('target already selected')
    const [first, ...rest] = input
    const name = typeof first === 'string' && rest.length ? first : null
    const args = name === null ? input : rest
    const [subject, key] = args
    let target: RuntimeTarget
    if (args.length === 1 && typeof subject === 'function') target = { kind: 'function', fn: functionValue(subject) }
    else if (args.length === 2 && subject && typeof key === 'string')
      target = { kind: 'method', object: objectValue(subject), key, fn: methodValue(subject, key) }
    else throw new TypeError('target requires a function or object method')
    return this.copy({
      stage: 'target',
      name: name ?? (target.kind === 'method' ? target.key : functionValue(target.fn).name || '<anonymous>'),
      target,
    })
  }
  addCase(
    mode: CaseBlueprint['mode'],
    name: string,
    body?: object,
    row: CaseBlueprint['row'] = null,
    origin = this.#location(),
  ) {
    if (this.#data.stage !== 'target' && this.#data.stage !== 'suite') throw new TypeError('select target before cases')
    if (typeof name !== 'string') throw new TypeError('case name must be a string')
    let item: CaseBlueprint
    if (mode === 'todo') item = { name, mode, origin, row: null, config: {} }
    else {
      if (!body) throw new TypeError('case requires a body')
      const built = v.parse(
        v.instance(CaseBuilder),
        invoke(body, undefined, [
          new CaseBuilder<F, C>({ config: {}, mocks: [], args: null, expect: null, calls: [] }),
        ]),
      )
      item = built.completed({ name, mode, origin, row })
    }
    return this.copy({ stage: 'suite', cases: [...this.#data.cases, item] })
  }
  it(name: string, body: (t: ItBuilder<F, C>) => ItDone): Suite<F, C, R>
  it(name: string, body: object): object {
    return this.addCase('run', name, body)
  }
  only(name: string, body: (t: ItBuilder<F, C>) => ItDone): Suite<F, C, R>
  only(name: string, body: object): object {
    return this.addCase('only', name, body)
  }
  skip(name: string, body: (t: ItBuilder<F, C>) => ItDone): Suite<F, C, R>
  skip(name: string, body: object): object {
    return this.addCase('skip', name, body)
  }
  todo(name: string): Suite<F, C, R>
  todo(name: string): object {
    return this.addCase('todo', name)
  }
  each<const Row>(
    name: string | ((row: NoInfer<Row>) => string),
    rows: readonly Row[],
    body: (t: ItBuilder<F, C>, row: NoInfer<Row>) => ItDone,
  ): Suite<F, C, R>
  each(name: string | object, input: readonly Value[], body: object): object {
    const rows = arrayValue(input)
    if (!rows.length) throw new TypeError('each requires nonempty rows')
    const origin = this.#location()
    return rows.reduce<DefinitionBuilder<R, C, F>>((test, row, index) => {
      const display =
        typeof name === 'string' ? `${name} [${index + 1}]` : v.parse(v.string(), invoke(name, undefined, [row]))
      return test.addCase(
        'run',
        display,
        (builder: object) => invoke(body, undefined, [builder, row]),
        { index, value: row },
        origin,
      )
    }, this)
  }
  group<S extends object>(
    m: Middleware<R, S>,
    children: CompatibleChildren<ExtendContext<C, S>, ExtendContext<R, S>>,
  ): GroupStage<C, R, 'group'>
  group<S extends object>(
    name: string,
    m: Middleware<R, S>,
    children: CompatibleChildren<ExtendContext<C, S>, ExtendContext<R, S>>,
  ): GroupStage<C, R, 'group'>
  group<const D extends GroupChildren<C>>(children: D): GroupStage<C, R, FirstPhase<ChildrenPhase<D>>>
  group<const D extends GroupChildren<C>>(name: string, children: D): GroupStage<C, R, FirstPhase<ChildrenPhase<D>>>
  group(...input: Value[]): object {
    if (this.#data.stage !== 'base' && this.#data.stage !== 'group')
      throw new TypeError('group requires a group builder')
    const origin = this.#location(),
      [first, ...rest] = input
    const name = typeof first === 'string' ? first : null
    const args = name === null ? input : rest
    const head = args[0]
    const step =
      head !== null && typeof head === 'object' && property(head, middlewareTag) === true
        ? checkedMiddleware(head)
        : null
    const childrenInput = step ? args.slice(1) : args
    if (childrenInput.length !== 1) throw new TypeError('group requires completed children')
    const children = v.parse(v.array(v.instance(DefinitionBuilder)), childrenInput[0])
    if (!children.length || children.some((child) => !isDefinition(child)))
      throw new TypeError('group requires completed children')
    for (const child of children) {
      markDefinitionUsed(child)
    }
    const group: RuntimeGroup = {
      version: 1,
      kind: 'group',
      name,
      origin,
      middleware: step,
      config: {},
      steps: [],
      mocks: [],
      children: children.map((child) => ({ origin, blueprint: child.blueprint() })),
    }
    return this.copy({ stage: 'group', groups: [...this.#data.groups, group] })
  }
  blueprint(): RuntimeBlueprint {
    const d = this.#data
    if (d.stage === 'suite') {
      if (d.name === null || d.target === null) throw new TypeError('test definition is incomplete')
      return {
        version: 1,
        kind: 'test',
        name: d.name,
        target: d.target,
        cases: [...d.cases],
        config: { ...d.config },
        steps: [...d.steps],
        mocks: [...d.mocks],
      }
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

function checkedMiddleware(value: object): RuntimeMiddleware {
  const timeout = v.parse(v.optional(v.number()), property(value, 'timeout'))
  return { [middlewareTag]: true, kind: 'middleware', run: functionValue(property(value, 'run')), timeout }
}

export function isDefinition<T>(value: T): boolean {
  return value instanceof DefinitionBuilder && value[definitionTag] === true
}

export function createTest(location: () => SourceLocation): TestConstructor {
  return class Test<R extends object = {}> extends DefinitionBuilder<R> {
    constructor() {
      super(location)
    }
  }
}
