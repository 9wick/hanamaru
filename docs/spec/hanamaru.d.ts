/** 公開APIの設計用型契約。フレームワークの実装・配布物ではない。 */
export type AnyFn = (...args: any[]) => any
export type FnKeys<O> = Extract<{
  [K in keyof O]-?: O[K] extends AnyFn ? K : never
}[keyof O], string>
export type MethodOf<O, K extends keyof O> = Extract<O[K], AnyFn>
export type MockEntry = { readonly obj: object; readonly key: string }
export type RegKey<M extends readonly MockEntry[], O> = Extract<M[number], { obj: O }>['key']

declare const assertionBrand: unique symbol
declare const doneBrand: unique symbol
declare const definitionBrand: unique symbol
declare const behaviorBrand: unique symbol
declare const planBrand: unique symbol
export interface ItDone { readonly [doneBrand]: true }
export interface TestDefinition { readonly [definitionBrand]: true }
export type Behavior<F extends AnyFn> = BehaviorPlan & {
  readonly [behaviorBrand]: (fn: F) => F
}
export interface BehaviorBuilder<F extends AnyFn> {
  returns(value: ReturnType<F>): Behavior<F>
  resolves(value: ReturnType<F> extends PromiseLike<unknown> ? Awaited<ReturnType<F>> : never): Behavior<F>
  throws(error: unknown): Behavior<F>
  rejects(error: ReturnType<F> extends PromiseLike<unknown> ? unknown : never): Behavior<F>
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
  toBeInstanceOf(ctor: new (...args: any[]) => object): ErrorAssertion
  toThrow(message: string | RegExp): ErrorAssertion
  toMatchObject(value: Record<string, unknown>): ErrorAssertion
  toSatisfy(predicate: (error: unknown) => boolean): ErrorAssertion
}
export interface MockAssertions<F extends AnyFn> {
  calledTimes(count: number): MockAssertion
  notCalled(): MockAssertion
  calledWith(...args: Parameters<F>): MockAssertion
  calledOnceWith(...args: Parameters<F>): MockAssertion
}
export interface Expect<F extends AnyFn, M extends readonly MockEntry[], C> {
  readonly result: ValueAssertions<Awaited<ReturnType<F>>>
  readonly error: ErrorAssertions
  readonly ctx: C
  mock<O extends object, K extends FnKeys<O> & RegKey<M, NoInfer<O>>>(obj: O, key: K): MockAssertions<MethodOf<O, K>>
}
export interface ItBuilder<F extends AnyFn, M extends readonly MockEntry[], C> {
  mock<O extends object, K extends FnKeys<O>>(obj: O, key: K, def: MockDef<MethodOf<O, K>>): ItBuilder<F, [...M, { obj: O; key: K }], C>
  args(...args: Parameters<F>): ItArgs<F, M, C>
  argsFrom(build: (ctx: C) => Parameters<F>): ItArgs<F, M, C>
}
export interface ItArgs<F extends AnyFn, M extends readonly MockEntry[], C> {
  mock<O extends object, K extends FnKeys<O>>(obj: O, key: K, def: MockDef<MethodOf<O, K>>): ItArgs<F, [...M, { obj: O; key: K }], C>
  expect(build: (e: Expect<F, M, C>) => Assertions): ItDone
}
export interface CaseMethods<F extends AnyFn, M extends readonly MockEntry[], C> {
  it(name: string, body: (t: ItBuilder<F, M, C>) => ItDone): Suite<F, M, C>
  only(name: string, body: (t: ItBuilder<F, M, C>) => ItDone): Suite<F, M, C>
  skip(name: string, body: (t: ItBuilder<F, M, C>) => ItDone): Suite<F, M, C>
  todo(name: string): Suite<F, M, C>
}
export interface Suite<F extends AnyFn, M extends readonly MockEntry[], C> extends CaseMethods<F, M, C>, TestDefinition {
  plan(): TestPlan<F, C>
}
export interface TestBuilder<F extends AnyFn, M extends readonly MockEntry[], C> extends CaseMethods<F, M, C> {
  describe(name: string): TestBuilder<F, M, C>
  setup<S>(create: () => S, dispose?: (ctx: Awaited<S>) => void | Promise<void>): TestBuilder<F, M, Awaited<S>>
  mock<O extends object, K extends FnKeys<O>>(obj: O, key: K, def: MockDef<MethodOf<O, K>>): TestBuilder<F, [...M, { obj: O; key: K }], C>
}
export interface TargetStage<C> {
  target<F extends AnyFn>(fn: F): TestBuilder<F, [], C>
  target<O extends object, K extends FnKeys<O>>(obj: O, key: K): TestBuilder<MethodOf<O, K>, [], C>
}
export declare class Test implements TargetStage<{}> {
  setup<S>(create: () => S, dispose?: (ctx: Awaited<S>) => void | Promise<void>): TargetStage<Awaited<S>>
  target<F extends AnyFn>(fn: F): TestBuilder<F, [], {}>
  target<O extends object, K extends FnKeys<O>>(obj: O, key: K): TestBuilder<MethodOf<O, K>, [], {}>
}

/** 実行計画は値・参照・遅延評価する関数を保持する。 */
export type ValuePlan<V, C> =
  | { readonly kind: 'value'; readonly value: V }
  | { readonly kind: 'from-context'; readonly build: (ctx: C) => V }
export type TargetPlan<F extends AnyFn> =
  | { readonly kind: 'function'; readonly fn: F }
  | { readonly kind: 'method'; readonly object: object; readonly key: string; readonly fn: F }
export interface SetupPlan<C> {
  readonly create: () => C | Promise<C>
  readonly dispose?: (ctx: C) => void | Promise<void>
}
export type BehaviorPlan =
  | { readonly kind: 'returns' | 'resolves'; readonly value: unknown }
  | { readonly kind: 'throws' | 'rejects'; readonly error: unknown }
  | { readonly kind: 'callsFake'; readonly fn: AnyFn }
export interface MockPlan {
  readonly object: object
  readonly key: string
  readonly behavior: BehaviorPlan
}
export type ValueCheck<V> =
  | { readonly matcher: 'toBe' | 'toEqual'; readonly expected: V }
  | { readonly matcher: 'toMatchObject'; readonly expected: V extends object ? Partial<V> : never }
  | { readonly matcher: 'toSatisfy'; readonly predicate: (value: V) => boolean }
export type ResultAssertion<V = any> = {
  readonly [assertionBrand]: true
  readonly subject: 'result'
  readonly check: ValueCheck<V>
}
export type ErrorAssertion = {
  readonly [assertionBrand]: true
  readonly subject: 'error'
  readonly check:
    | { readonly matcher: 'toBeInstanceOf'; readonly ctor: new (...args: any[]) => object }
    | { readonly matcher: 'toThrow'; readonly message: string | RegExp }
    | { readonly matcher: 'toMatchObject'; readonly expected: Record<string, unknown> }
    | { readonly matcher: 'toSatisfy'; readonly predicate: (error: unknown) => boolean }
}
export type MockAssertion = {
  readonly [assertionBrand]: true
  readonly subject: 'mock'
  readonly object: object
  readonly key: string
  readonly check:
    | { readonly matcher: 'calledTimes'; readonly count: number }
    | { readonly matcher: 'notCalled' }
    | { readonly matcher: 'calledWith' | 'calledOnceWith'; readonly args: readonly unknown[] }
}
export type Assertion = ResultAssertion | ErrorAssertion | MockAssertion
export type Assertions =
  | readonly [ResultAssertion | MockAssertion, ...(ResultAssertion | MockAssertion)[]]
  | readonly [ErrorAssertion | MockAssertion, ...(ErrorAssertion | MockAssertion)[]]
export interface ExpectationPlan<C> {
  readonly kind: 'deferred'
  /** 元のexpectコールバックにctxと記述子ビルダーを渡す処理。targetの後に評価する。 */
  readonly build: (ctx: C) => Assertions
}
export interface ExecutableCase<F extends AnyFn, C> {
  readonly name: string
  readonly mode: 'run' | 'only' | 'skip'
  readonly mocks: readonly MockPlan[]
  readonly args: ValuePlan<Parameters<F>, C>
  readonly expect: ExpectationPlan<C>
}
export interface TodoCase {
  readonly name: string
  readonly mode: 'todo'
}
export interface TestPlan<F extends AnyFn = AnyFn, C = any> {
  readonly [planBrand]: true
  readonly version: 1
  readonly name: string
  readonly target: TargetPlan<F>
  readonly setup: SetupPlan<C> | null
  readonly cases: readonly (ExecutableCase<F, C> | TodoCase)[]
}
export interface Failure {
  readonly phase: 'setup' | 'mock' | 'args' | 'target' | 'expect' | 'assertion' | 'cleanup'
  readonly message: string
  readonly assertionIndex?: number
}
export interface CaseResult {
  readonly name: string
  readonly status: 'passed' | 'failed' | 'skipped' | 'todo'
  readonly durationMs: number
  readonly failures: readonly Failure[]
}
export interface TestResult {
  readonly name: string
  readonly status: 'passed' | 'failed'
  readonly cases: readonly CaseResult[]
}
export interface RunResult {
  readonly version: 1
  readonly status: 'passed' | 'failed'
  readonly tests: readonly TestResult[]
}
export interface RunOptions { readonly forbidOnly?: boolean }
export declare function run(plan: TestPlan | readonly TestPlan[], options?: RunOptions): Promise<RunResult>
export interface Config {
  readonly include?: readonly string[]
  readonly exclude?: readonly string[]
  readonly reporter?: 'pretty' | 'json'
}
export declare function defineConfig(config: Config): Config
