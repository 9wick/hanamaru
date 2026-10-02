import type { Resource, ResourceFields } from '../../domain/definition/resource.js'
import type {
  Assertions,
  CallAssertion,
  CallExpectations,
  ErrorAssertion,
  ResultAssertion,
} from '../../domain/assertion/types.js'
import { doneTag, middlewareTag } from '../../domain/definition/tags.js'
import type {
  BehaviorBlueprint,
  Ctx,
  DefinitionBlueprint,
  DefinitionHandle,
  ExtendContext,
  InputPhase,
  MiddlewareFn,
  SuiteBlueprint,
  TestDefinition,
} from '../../domain/definition/types.js'
import { definitionBrand } from '../../domain/definition/types.js'
import type { AnyFn, FnKeys, MethodOf } from '../../foundation/functions.js'
import type { Value } from '../../foundation/value.js'

declare const behaviorBrand: unique symbol

export interface ItDone {
  readonly [doneTag]: true
}

/** middleware()が返す値。関数をそのまま.use/.groupへ渡せないようにする。 */
export interface Middleware<C = Value, S extends object = object> {
  readonly [middlewareTag]: true
  readonly run: MiddlewareFn<C, S>
  readonly kind: 'middleware'
  readonly timeout: number | undefined
}

export type Behavior<F extends AnyFn> = BehaviorBlueprint & {
  readonly [behaviorBrand]: (fn: F) => F
}

export interface BehaviorBuilder<F extends AnyFn> {
  returnsOnce(value: ReturnType<F>): BehaviorBuilder<F>
  resolvesOnce(
    value: ReturnType<F> extends PromiseLike<Value | void> ? Awaited<ReturnType<F>> : never,
  ): BehaviorBuilder<F>
  throwsOnce(error: Value): BehaviorBuilder<F>
  rejectsOnce(error: ReturnType<F> extends PromiseLike<Value | void> ? Value : never): BehaviorBuilder<F>
  callsFakeOnce(fn: F): BehaviorBuilder<F>
  returns(value: ReturnType<F>): Behavior<F>
  resolves(value: ReturnType<F> extends PromiseLike<Value | void> ? Awaited<ReturnType<F>> : never): Behavior<F>
  throws(error: Value): Behavior<F>
  rejects(error: ReturnType<F> extends PromiseLike<Value | void> ? Value : never): Behavior<F>
  callsFake(fn: F): Behavior<F>
}

export type MockDef<F extends AnyFn> = (m: BehaviorBuilder<F>) => Behavior<F>

export interface ValueAssertions<V> {
  toBe(value: V): ResultAssertion<V>
  toEqual(value: V): ResultAssertion<V>
  toMatchObject(value: V extends object ? Partial<V> : never): ResultAssertion<V>
  toSatisfy(predicate: (value: V) => boolean): ResultAssertion<V>
}

export interface ErrorAssertions {
  toBeInstanceOf(ctor: new (...args: never[]) => object): ErrorAssertion
  toThrow(message: string | RegExp): ErrorAssertion
  toMatchObject(value: Record<string, Value>): ErrorAssertion
  toSatisfy(predicate: (error: Value) => boolean): ErrorAssertion
}

export interface CallMatchers<F extends AnyFn, C = object> {
  calledTimes(count: number): CallAssertion
  notCalled(): CallAssertion
  calledWith(...args: Parameters<F>): CallAssertion
  calledOnceWith(...args: Parameters<F>): CallAssertion
  calledNthWith(n: number, ...args: Parameters<F>): CallAssertion
  calledWithFrom(build: (ctx: Ctx<C>) => Parameters<F>): CallAssertion
  calledOnceWithFrom(build: (ctx: Ctx<C>) => Parameters<F>): CallAssertion
  calledNthWithFrom(n: number, build: (ctx: Ctx<C>) => Parameters<F>): CallAssertion
}

/** 呼び出しは行わず、メソッドの呼び出し条件を記述する。 */
export interface CallBuilder<C = object> {
  <O extends object, K extends FnKeys<O>>(obj: O, key: K): CallMatchers<MethodOf<O, K>, C>
  from<O extends object, K extends string>(
    build: (ctx: Ctx<C>) => O,
    key: K & FnKeys<NoInfer<O>>,
  ): CallMatchers<MethodOf<O, Extract<K, keyof O>>, C>
}

export interface Expect<F extends AnyFn, C> {
  readonly result: ValueAssertions<Awaited<ReturnType<F>>>
  readonly error: ErrorAssertions
  readonly ctx: Ctx<C>
}

export type CallsBuilder<C = object> = (call: CallBuilder<C>) => CallExpectations

export interface ItBuilder<F extends AnyFn, C> extends ExecutionSettings<ItBuilder<F, C>> {
  mock<O extends object, K extends FnKeys<O>>(obj: O, key: K, def: MockDef<MethodOf<O, K>>): ItBuilder<F, C>
  require<T extends Resource>(r: T): ItBuilder<F, ExtendContext<ResourceFields<T>, C>>
  args(...args: Parameters<F>): ItArgs<F, C>
  argsFrom(build: (ctx: Ctx<C>) => Parameters<F>): ItArgs<F, C>
}

export interface ItArgs<F extends AnyFn, C> extends ExecutionSettings<ItArgs<F, C>> {
  mock<O extends object, K extends FnKeys<O>>(obj: O, key: K, def: MockDef<MethodOf<O, K>>): ItArgs<F, C>
  expect(build: (e: Expect<F, C>) => Assertions): ItExpected<C>
  expectCalls(build: CallsBuilder<C>): ItCalls<F, C>
}

export interface ItExpected<C = object> extends ItDone {
  expectCalls(build: CallsBuilder<C>): ItDone
}

export interface ItCalls<F extends AnyFn, C> extends ItDone {
  expect(build: (e: Expect<F, C>) => Assertions): ItDone
}

export interface CaseMethods<F extends AnyFn, C, R extends object = {}> {
  each<const Row>(
    name: string | ((row: NoInfer<Row>) => string),
    rows: readonly Row[],
    body: (t: ItBuilder<F, C>, row: NoInfer<Row>) => ItDone,
  ): Suite<F, C, R>
  it(name: string, body: (t: ItBuilder<F, C>) => ItDone): Suite<F, C, R>
  only(name: string, body: (t: ItBuilder<F, C>) => ItDone): Suite<F, C, R>
  skip(name: string, body: (t: ItBuilder<F, C>) => ItDone): Suite<F, C, R>
  todo(name: string): Suite<F, C, R>
}

export interface Suite<F extends AnyFn, C, R extends object = {}>
  extends CaseMethods<F, C, R>, DefinitionHandle<R, 'attempt'> {
  blueprint(): SuiteBlueprint<F, C, R>
}

export interface TestBuilder<F extends AnyFn, C, R extends object = {}>
  extends CaseMethods<F, C, R>, ExecutionSettings<TestBuilder<F, C, R>> {
  require<T extends Resource>(r: T): TestBuilder<F, ExtendContext<ResourceFields<T>, C>, R>
  use<S extends object>(m: Middleware<C, S>): TestBuilder<F, ExtendContext<C, S>, R>
  mock<O extends object, K extends FnKeys<O>>(obj: O, key: K, def: MockDef<MethodOf<O, K>>): TestBuilder<F, C, R>
}

export type GroupChildren<C extends object> = readonly [TestDefinition<C>, ...TestDefinition<C>[]]

type CompatibleChild<C extends object, Before extends object> =
  | DefinitionHandle<C, 'attempt'>
  | DefinitionHandle<Before, 'group'>

export type CompatibleChildren<C extends object, Before extends object> = readonly [
  CompatibleChild<C, Before>,
  ...CompatibleChild<C, Before>[],
]

export type FirstPhase<P extends InputPhase> = 'group' extends P ? 'group' : 'attempt'

export type ChildrenPhase<D extends readonly TestDefinition<never>[]> = D[number][typeof definitionBrand]['phase']

interface GroupMethods<C extends object, R extends object, P extends InputPhase = 'attempt', G extends object = R> {
  /** middlewareを取る形を先に並べ、その場で書いたmiddlewareのctxを文脈から型付けする。 */
  group<S extends object>(
    m: Middleware<G, S>,
    children: CompatibleChildren<ExtendContext<C, S>, ExtendContext<G, S>>,
  ): GroupStage<C, R, 'group', G>
  group<S extends object>(
    name: string,
    m: Middleware<G, S>,
    children: CompatibleChildren<ExtendContext<C, S>, ExtendContext<G, S>>,
  ): GroupStage<C, R, 'group', G>
  group<const D extends CompatibleChildren<C, G>>(children: D): GroupStage<C, R, FirstPhase<P | ChildrenPhase<D>>, G>
  group<const D extends CompatibleChildren<C, G>>(
    name: string,
    children: D,
  ): GroupStage<C, R, FirstPhase<P | ChildrenPhase<D>>, G>
}

export interface GroupStage<C extends object, R extends object, P extends InputPhase, G extends object = R>
  extends GroupMethods<C, R, P, G>, DefinitionHandle<R, P> {
  /** チェーン内の複数groupと共通設定を取得する。GroupSuite自体は実行階層ではない。 */
  blueprint(): DefinitionBlueprint<R>
}

export type GroupSuite<C extends object, R extends object = {}> =
  | GroupStage<C, R, 'attempt'>
  | GroupStage<C, R, 'group'>

export interface TargetStage<C extends object, R extends object = {}, G extends object = R>
  extends GroupMethods<C, R, 'attempt', G>, ExecutionSettings<TargetStage<C, R, G>> {
  require<T extends Resource>(
    r: T,
  ): TargetStage<ExtendContext<ResourceFields<T>, C>, R, ExtendContext<ResourceFields<T>, G>>
  use<S extends object>(m: Middleware<C, S>): TargetStage<ExtendContext<C, S>, R, G>
  mock<O extends object, K extends FnKeys<O>>(obj: O, key: K, def: MockDef<MethodOf<O, K>>): TargetStage<C, R, G>
  target<F extends AnyFn>(fn: F): TestBuilder<F, C, R>
  target<F extends AnyFn>(name: string, fn: F): TestBuilder<F, C, R>
  target<O extends object, K extends FnKeys<O>>(obj: O, key: K): TestBuilder<MethodOf<O, K>, C, R>
  target<O extends object, K extends FnKeys<O>>(name: string, obj: O, key: K): TestBuilder<MethodOf<O, K>, C, R>
}

export type Test<R extends object = {}> = TargetStage<R, R>

export interface TestConstructor {
  new <R extends object = {}>(): Test<R>
}

export interface ExecutionSettings<Self> {
  timeout(ms: number): Self
  retry(count: number): Self
}
