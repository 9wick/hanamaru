/** 公開APIの設計用型契約。フレームワークの実装・配布物ではない。 */
export type AnyFn = (...args: any[]) => any
export type FnKeys<O> = Extract<{
  [K in keyof O]-?: O[K] extends AnyFn ? K : never
}[keyof O], string>
export type MethodOf<O, K extends keyof O> = Extract<O[K], AnyFn>

declare const assertionBrand: unique symbol
declare const doneBrand: unique symbol
declare const definitionBrand: unique symbol
declare const behaviorBrand: unique symbol
declare const planBrand: unique symbol
declare const middlewareBrand: unique symbol
export interface ItDone { readonly [doneBrand]: true }
export interface TestDefinition<R extends object = {}> {
  /** 親に要求するctx。関数プロパティで反変にし、供給できない合成を防ぐ。 */
  readonly [definitionBrand]: (ctx: R) => void
}
export type ExtendContext<C, S> = C extends unknown
  ? S extends unknown ? Omit<C, keyof S> & S : never
  : never
type SetupReturn<S> = S & (Awaited<S> extends object ? unknown : never)
/** nextの完了値。追加フィールドの型をmiddlewareの戻り値まで伝える。 */
export interface MiddlewareResult<S extends object> {
  readonly [middlewareBrand]: S
}
export interface Next {
  (): Promise<MiddlewareResult<{}>>
  <S extends object>(fields: S): Promise<MiddlewareResult<S>>
}
export type Middleware<C, S extends object> =
  (ctx: Readonly<C>, next: Next) => Promise<MiddlewareResult<S>>
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
export interface CallMatchers<F extends AnyFn> {
  calledTimes(count: number): CallAssertion
  notCalled(): CallAssertion
  calledWith(...args: Parameters<F>): CallAssertion
  calledOnceWith(...args: Parameters<F>): CallAssertion
}
/** 呼び出しは行わず、メソッドの呼び出し条件を記述する。 */
export interface CallBuilder {
  <O extends object, K extends FnKeys<O>>(obj: O, key: K): CallMatchers<MethodOf<O, K>>
}
export interface Expect<F extends AnyFn, C> {
  readonly result: ValueAssertions<Awaited<ReturnType<F>>>
  readonly error: ErrorAssertions
  readonly ctx: Readonly<C>
}
export type CallExpectations = readonly [CallAssertion, ...CallAssertion[]]
export type CallsBuilder = (call: CallBuilder) => CallExpectations
export interface ItBuilder<F extends AnyFn, C> {
  mock<O extends object, K extends FnKeys<O>>(obj: O, key: K, def: MockDef<MethodOf<O, K>>): ItBuilder<F, C>
  args(...args: Parameters<F>): ItArgs<F, C>
  argsFrom(build: (ctx: Readonly<C>) => Parameters<F>): ItArgs<F, C>
}
export interface ItArgs<F extends AnyFn, C> {
  mock<O extends object, K extends FnKeys<O>>(obj: O, key: K, def: MockDef<MethodOf<O, K>>): ItArgs<F, C>
  expect(build: (e: Expect<F, C>) => Assertions): ItExpected
  expectCalls(build: CallsBuilder): ItCalls<F, C>
}
export interface ItExpected extends ItDone {
  expectCalls(build: CallsBuilder): ItDone
}
export interface ItCalls<F extends AnyFn, C> extends ItDone {
  expect(build: (e: Expect<F, C>) => Assertions): ItDone
}
export interface CaseMethods<F extends AnyFn, C, R extends object = {}> {
  it(name: string, body: (t: ItBuilder<F, C>) => ItDone): Suite<F, C, R>
  only(name: string, body: (t: ItBuilder<F, C>) => ItDone): Suite<F, C, R>
  skip(name: string, body: (t: ItBuilder<F, C>) => ItDone): Suite<F, C, R>
  todo(name: string): Suite<F, C, R>
}
export interface Suite<F extends AnyFn, C, R extends object = {}> extends CaseMethods<F, C, R>, TestDefinition<R> {
  plan(): SuitePlan<F, C, R>
}
export interface TestBuilder<F extends AnyFn, C, R extends object = {}> extends CaseMethods<F, C, R> {
  describe(name: string): TestBuilder<F, C, R>
  setup<S>(create: (ctx: Readonly<C>) => SetupReturn<S>): TestBuilder<F, ExtendContext<C, Awaited<S>>, R>
  use<S extends object>(middleware: Middleware<C, S>): TestBuilder<F, ExtendContext<C, S>, R>
  mock<O extends object, K extends FnKeys<O>>(obj: O, key: K, def: MockDef<MethodOf<O, K>>): TestBuilder<F, C, R>
}
export interface GroupMethods<C extends object, R extends object = {}> {
  group(child: TestDefinition<C>): GroupSuite<C, R>
  group(name: string, child: TestDefinition<C>): GroupSuite<C, R>
}
export interface GroupSuite<C extends object, R extends object = {}> extends GroupMethods<C, R>, TestDefinition<R> {
  plan(): GroupPlan<R>
}
export interface TargetStage<C extends object, R extends object = {}> extends GroupMethods<C, R> {
  describe(name: string): TargetStage<C, R>
  setup<S>(create: (ctx: Readonly<C>) => SetupReturn<S>): TargetStage<ExtendContext<C, Awaited<S>>, R>
  use<S extends object>(middleware: Middleware<C, S>): TargetStage<ExtendContext<C, S>, R>
  mock<O extends object, K extends FnKeys<O>>(obj: O, key: K, def: MockDef<MethodOf<O, K>>): TargetStage<C, R>
  target<F extends AnyFn>(fn: F): TestBuilder<F, C, R>
  target<O extends object, K extends FnKeys<O>>(obj: O, key: K): TestBuilder<MethodOf<O, K>, C, R>
}
export declare class Test<R extends object = {}> implements TargetStage<R, R> {
  describe(name: string): TargetStage<R, R>
  setup<S>(create: (ctx: Readonly<R>) => SetupReturn<S>): TargetStage<ExtendContext<R, Awaited<S>>, R>
  use<S extends object>(middleware: Middleware<R, S>): TargetStage<ExtendContext<R, S>, R>
  mock<O extends object, K extends FnKeys<O>>(obj: O, key: K, def: MockDef<MethodOf<O, K>>): TargetStage<R, R>
  target<F extends AnyFn>(fn: F): TestBuilder<F, R, R>
  target<O extends object, K extends FnKeys<O>>(obj: O, key: K): TestBuilder<MethodOf<O, K>, R, R>
  group(child: TestDefinition<R>): GroupSuite<R, R>
  group(name: string, child: TestDefinition<R>): GroupSuite<R, R>
}

/** 実行計画は値・参照・遅延評価する関数を保持する。 */
export type ValuePlan<V, C> =
  | { readonly kind: 'value'; readonly value: V }
  | { readonly kind: 'from-context'; readonly build: (ctx: Readonly<C>) => V }
export type TargetPlan<F extends AnyFn> =
  | { readonly kind: 'function'; readonly fn: F }
  | { readonly kind: 'method'; readonly object: object; readonly key: string; readonly fn: F }
export interface SetupPlan<C = any, S extends object = any> {
  readonly kind: 'setup'
  readonly create: (ctx: Readonly<C>) => S | Promise<S>
}
export interface MiddlewarePlan<C = any, S extends object = any> {
  readonly kind: 'middleware'
  readonly run: Middleware<C, S>
}
export type StepPlan = SetupPlan | MiddlewarePlan
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
export type CallAssertion = {
  readonly [assertionBrand]: true
  readonly subject: 'call'
  readonly object: object
  readonly key: string
  readonly check:
    | { readonly matcher: 'calledTimes'; readonly count: number }
    | { readonly matcher: 'notCalled' }
    | { readonly matcher: 'calledWith' | 'calledOnceWith'; readonly args: readonly unknown[] }
}
export type Assertion = ResultAssertion | ErrorAssertion
export type Assertions =
  | readonly [ResultAssertion, ...ResultAssertion[]]
  | readonly [ErrorAssertion, ...ErrorAssertion[]]
export interface ExpectationPlan<C> {
  readonly kind: 'deferred'
  /** 元のexpectコールバックにctxと記述子ビルダーを渡す処理。targetの後に評価する。 */
  readonly build: (ctx: Readonly<C>) => Assertions
}
export type ExecutableCase<F extends AnyFn, C> = {
  readonly name: string
  readonly mode: 'run' | 'only' | 'skip'
  readonly mocks: readonly MockPlan[]
  readonly args: ValuePlan<Parameters<F>, C>
} & (
  | { readonly expect: ExpectationPlan<C>; readonly calls: readonly CallAssertion[] }
  | { readonly expect: null; readonly calls: CallExpectations }
)
export interface TodoCase {
  readonly name: string
  readonly mode: 'todo'
}
export interface PlanBase<R extends object> {
  readonly [planBrand]: (ctx: R) => void
  readonly version: 1
  readonly steps: readonly StepPlan[]
  readonly mocks: readonly MockPlan[]
}
export interface SuitePlan<F extends AnyFn = AnyFn, C = any, R extends object = {}> extends PlanBase<R> {
  readonly kind: 'test'
  readonly name: string
  readonly target: TargetPlan<F>
  readonly cases: readonly (ExecutableCase<F, C> | TodoCase)[]
}
export interface GroupPlan<R extends object = {}> extends PlanBase<R> {
  readonly kind: 'group'
  readonly name: string | null
  readonly children: readonly GroupEntry[]
}
export interface GroupEntry {
  readonly name: string | null
  /** 子の要求型は階層内では隠す。取り出して単独実行はできない。 */
  readonly plan: TestPlan<never>
}
export type TestPlan<R extends object = {}> = SuitePlan<AnyFn, any, R> | GroupPlan<R>
export interface Failure {
  readonly phase: 'setup' | 'middleware' | 'instrumentation' | 'args' | 'target' | 'expect' | 'assertion' | 'cleanup'
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
  readonly kind: 'test'
  readonly name: string
  readonly status: 'passed' | 'failed'
  readonly cases: readonly CaseResult[]
}
export interface GroupResult {
  readonly kind: 'group'
  readonly name: string | null
  readonly status: 'passed' | 'failed'
  readonly children: readonly { readonly name: string | null; readonly result: TestResult | GroupResult }[]
}
export interface RunResult {
  readonly version: 1
  readonly status: 'passed' | 'failed'
  readonly tests: readonly (TestResult | GroupResult)[]
}
export interface RunOptions { readonly forbidOnly?: boolean }
export declare function run(plan: TestPlan | readonly TestPlan[], options?: RunOptions): Promise<RunResult>
export interface Config {
  readonly include?: readonly string[]
  readonly exclude?: readonly string[]
  readonly reporter?: 'pretty' | 'json'
}
export declare function defineConfig(config: Config): Config
