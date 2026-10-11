import type { Resource, ResourceFields } from '../../domain/definition/resource.js'
import { buildCallPlan } from '../../domain/definition/calls.js'
import type { CallOutput, CallsResult, InvocationBuilder, NonemptyOutput } from '../../domain/definition/calls.js'
import type {
  CallCheck,
  RuntimeCallAssertion,
  RuntimeValueAssertion,
  ValueCheck,
} from '../../domain/assertion/runtime.js'
import type { Assertions } from '../../domain/assertion/types.js'
import { checkedCall } from '../../domain/assertion/validation.js'
import {
  callsAllowed,
  caseDone,
  completedCase,
  withArgs,
  withCalls,
  withExpectation,
  withMock,
  withRetry,
  withResource,
  withTimeout,
} from '../../domain/definition/construction.js'
import { methodValue } from '../../domain/definition/operations.js'
import type {
  CaseBlueprint,
  CaseData,
  Fields,
  RuntimeBehavior,
  RuntimeCase,
  RuntimeMock,
  RuntimeTarget,
} from '../../domain/definition/runtime.js'
import { assertionTag, behaviorTag, doneTag } from '../../domain/definition/tags.js'
import type { BehaviorAction, SourceLocation, ExtendContext } from '../../domain/definition/types.js'
import { checkedBehavior } from '../../domain/definition/validation.js'
import type { AnyFn, FnKeys, MethodOf } from '../../domain/definition/target-types.js'
import type { Value } from '../../domain/definition/javascript.js'
import { arrayValue, invoke, nonempty } from '../../domain/definition/javascript.js'
import type { ItBuilder, CallsBuilder, Expect, ItArgs, ItCalls, ItExpected, ItInvocations, MockDef } from './types.js'

function valueMatchers(subject: 'result' | 'error', negated?: true) {
  const assertion = (check: ValueCheck): RuntimeValueAssertion => ({
    [assertionTag]: true,
    subject,
    ...(negated === true ? { negated } : {}),
    check,
  })
  return {
    toBe: (value: Value) => assertion({ matcher: 'toBe', expected: value }),
    toEqual: (value: Value) => assertion({ matcher: 'toEqual', expected: value }),
    toMatchObject: (value: Value) => assertion({ matcher: 'toMatchObject', expected: value }),
    toSatisfy: (predicate: (value: Value) => Value) => assertion({ matcher: 'toSatisfy', predicate }),
    toBeInstanceOf: (ctor: new (...args: never[]) => object) => assertion({ matcher: 'toBeInstanceOf', ctor }),
    toThrow: (message: string | RegExp) => assertion({ matcher: 'toThrow', message }),
  }
}

function valueAssertions(subject: 'result' | 'error') {
  return { ...valueMatchers(subject), not: valueMatchers(subject, true) }
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

function behaviorBuilder(once: BehaviorAction[] = []): RuntimeBehaviorBuilder {
  const finish = (action: BehaviorAction): RuntimeBehavior =>
    once.length
      ? { [behaviorTag]: true, kind: 'sequence', once: nonempty(once), fallback: action }
      : { [behaviorTag]: true, ...action }
  const add = (action: BehaviorAction) => behaviorBuilder([...once, action])
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

export function createMock(object: object, key: string, def: object): RuntimeMock {
  if (typeof key !== 'string') throw new TypeError('mock target must be a method')
  methodValue(object, key)
  return { object, key, behavior: checkedBehavior(invoke(def, undefined, [behaviorBuilder()])) }
}

export class CaseBuilder<F extends AnyFn, C> {
  readonly #data: CaseData
  readonly #target: RuntimeTarget
  constructor(data: CaseData, target: RuntimeTarget) {
    this.#data = data
    this.#target = target
  }
  get [doneTag](): true {
    return caseDone(this.#data)
  }
  // 呼び出し元のチェーンは別クラスで #data を読めないため、完成検査と取り出しをここに置く。
  completed(
    base: {
      name: string
      mode: RuntimeCase['mode']
      origin: SourceLocation
      row: CaseBlueprint['row']
    },
    target: RuntimeTarget,
  ): RuntimeCase {
    if (this.#data.args?.kind === 'calls' && this.#data.args.target !== target)
      throw new TypeError('calls definition belongs to another target')
    return completedCase(this.#data, base)
  }
  #next(data: CaseData): CaseBuilder<F, C> {
    return new CaseBuilder(data, this.#target)
  }
  timeout(ms: number) {
    return this.#next(withTimeout(this.#data, ms))
  }
  retry(count: number) {
    return this.#next(withRetry(this.#data, count))
  }
  mock<O extends object, K extends FnKeys<O>>(object: O, key: K, def: MockDef<MethodOf<O, K>>): CaseBuilder<F, C> {
    return this.#next(withMock(this.#data, createMock(object, key, def)))
  }
  require<T extends Resource>(r: T): ItBuilder<F, ExtendContext<ResourceFields<T>, C>>
  require(r: Resource): object {
    return this.#next(withResource(this.#data, r))
  }
  args(...args: Parameters<F>): ItArgs<F, C> {
    if (this.#target.kind === 'relation') throw new TypeError('relation cases require calls()')
    return this.#next(withArgs(this.#data, { kind: 'value', value: arrayValue(args) }))
  }
  argsFrom(build: (ctx: Readonly<C>) => Parameters<F>): ItArgs<F, C> {
    if (this.#target.kind === 'relation') throw new TypeError('relation cases require calls()')
    return this.#next(withArgs(this.#data, { kind: 'from-context', build }))
  }
  calls<const O extends CallOutput>(
    build: (c: InvocationBuilder<F>) => O & NonemptyOutput<O>,
  ): ItInvocations<CallsResult<O>, C>
  calls(build: object): object {
    if (this.#data.args) throw new TypeError('args, argsFrom and calls are mutually exclusive')
    return this.#next(withArgs(this.#data, buildCallPlan(this.#target, build)))
  }
  expect(build: (e: Expect<F, C>) => Assertions): ItExpected<C> {
    return this.#next(
      withExpectation(this.#data, (ctx: Fields) =>
        invoke(build, undefined, [{ result: valueAssertions('result'), error: valueAssertions('error'), ctx }]),
      ),
    )
  }
  expectCalls(build: CallsBuilder<C>): ItCalls<F, C> {
    callsAllowed(this.#data)
    const calls = arrayValue(invoke(build, undefined, [callBuilder])).map(checkedCall)
    return this.#next(withCalls(this.#data, calls))
  }
}
