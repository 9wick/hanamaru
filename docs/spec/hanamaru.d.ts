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
declare const blueprintBrand: unique symbol
declare const middlewareBrand: unique symbol
declare const middlewareDefBrand: unique symbol
export interface ItDone { readonly [doneBrand]: true }
export interface TestDefinition<R extends object = {}> {
  /** 親に要求するctx。関数プロパティで反変にし、供給できない合成を防ぐ。 */
  readonly [definitionBrand]: (ctx: R) => void
  /** プラグイン向け。定義から実行前の構造を取得する。 */
  blueprint(): TestBlueprint<R>
}
export type ExtendContext<C, S> = C extends unknown
  ? S extends unknown ? Omit<C, keyof S> & S : never
  : never
/** nextの完了値。追加フィールドの型をmiddlewareの戻り値まで伝える。 */
export interface MiddlewareResult<S extends object> {
  readonly [middlewareBrand]: S
}
export interface Next {
  (): Promise<MiddlewareResult<{}>>
  <S extends object>(fields: S): Promise<MiddlewareResult<S>>
}
/** 利用者が要求するフィールドと、将来hanamaruがctxへ足すフィールドを合わせた型。 */
export type Ctx<C> = Readonly<C>
export type MiddlewareFn<C, S extends object> =
  (ctx: Ctx<C>, next: Next) => Promise<MiddlewareResult<S>>
export interface MiddlewareOptions {
  /** 前処理と後処理のそれぞれへ独立に適用する期限。 */
  readonly timeout?: number
}
/** middleware()が返す値。関数をそのまま.use/.groupへ渡せないようにする。 */
export interface Middleware<C = unknown, S extends object = object> {
  readonly [middlewareDefBrand]: MiddlewareFn<C, S>
}
export declare function middleware<C, S extends object>(
  fn: MiddlewareFn<C, S>, options?: MiddlewareOptions
): Middleware<C, S>
export type Behavior<F extends AnyFn> = BehaviorBlueprint & {
  readonly [behaviorBrand]: (fn: F) => F
}
export interface BehaviorBuilder<F extends AnyFn> {
  returnsOnce(value: ReturnType<F>): BehaviorBuilder<F>
  resolvesOnce(value: ReturnType<F> extends PromiseLike<unknown> ? Awaited<ReturnType<F>> : never): BehaviorBuilder<F>
  throwsOnce(error: unknown): BehaviorBuilder<F>
  rejectsOnce(error: ReturnType<F> extends PromiseLike<unknown> ? unknown : never): BehaviorBuilder<F>
  callsFakeOnce(fn: F): BehaviorBuilder<F>
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
  calledNthWith(n: number, ...args: Parameters<F>): CallAssertion
}
/** 呼び出しは行わず、メソッドの呼び出し条件を記述する。 */
export interface CallBuilder {
  <O extends object, K extends FnKeys<O>>(obj: O, key: K): CallMatchers<MethodOf<O, K>>
}
export interface Expect<F extends AnyFn, C> {
  readonly result: ValueAssertions<Awaited<ReturnType<F>>>
  readonly error: ErrorAssertions
  readonly ctx: Ctx<C>
}
export type CallExpectations = readonly [CallAssertion, ...CallAssertion[]]
export type CallsBuilder = (call: CallBuilder) => CallExpectations
export interface ItBuilder<F extends AnyFn, C> extends ExecutionSettings<ItBuilder<F, C>> {
  mock<O extends object, K extends FnKeys<O>>(obj: O, key: K, def: MockDef<MethodOf<O, K>>): ItBuilder<F, C>
  args(...args: Parameters<F>): ItArgs<F, C>
  argsFrom(build: (ctx: Ctx<C>) => Parameters<F>): ItArgs<F, C>
}
export interface ItArgs<F extends AnyFn, C> extends ExecutionSettings<ItArgs<F, C>> {
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
  each<const Row>(name: string | ((row: NoInfer<Row>) => string), rows: readonly Row[], body: (t: ItBuilder<F, C>, row: NoInfer<Row>) => ItDone): Suite<F, C, R>
  it(name: string, body: (t: ItBuilder<F, C>) => ItDone): Suite<F, C, R>
  only(name: string, body: (t: ItBuilder<F, C>) => ItDone): Suite<F, C, R>
  skip(name: string, body: (t: ItBuilder<F, C>) => ItDone): Suite<F, C, R>
  todo(name: string): Suite<F, C, R>
}
export interface Suite<F extends AnyFn, C, R extends object = {}> extends CaseMethods<F, C, R>, TestDefinition<R> {
  blueprint(): SuiteBlueprint<F, C, R>
}
export interface TestBuilder<F extends AnyFn, C, R extends object = {}> extends CaseMethods<F, C, R>, ExecutionSettings<TestBuilder<F, C, R>> {
  use<S extends object>(m: Middleware<C, S>): TestBuilder<F, ExtendContext<C, S>, R>
  mock<O extends object, K extends FnKeys<O>>(obj: O, key: K, def: MockDef<MethodOf<O, K>>): TestBuilder<F, C, R>
}
export type GroupChildren<C extends object> = readonly [TestDefinition<C>, ...TestDefinition<C>[]]
export interface GroupMethods<C extends object, R extends object = {}> {
  /** middlewareを取る形を先に並べ、その場で書いたmiddlewareのctxを文脈から型付けする。 */
  group<S extends object>(m: Middleware<R, S>, children: GroupChildren<ExtendContext<C, S>>): GroupSuite<C, R>
  group<S extends object>(name: string, m: Middleware<R, S>, children: GroupChildren<ExtendContext<C, S>>): GroupSuite<C, R>
  group(children: GroupChildren<C>): GroupSuite<C, R>
  group(name: string, children: GroupChildren<C>): GroupSuite<C, R>
}
export interface GroupSuite<C extends object, R extends object = {}> extends GroupMethods<C, R>, TestDefinition<R> {
  blueprint(): GroupBlueprint<R>
}
export interface TargetStage<C extends object, R extends object = {}> extends GroupMethods<C, R>, ExecutionSettings<TargetStage<C, R>> {
  use<S extends object>(m: Middleware<C, S>): TargetStage<ExtendContext<C, S>, R>
  mock<O extends object, K extends FnKeys<O>>(obj: O, key: K, def: MockDef<MethodOf<O, K>>): TargetStage<C, R>
  target<F extends AnyFn>(fn: F): TestBuilder<F, C, R>
  target<F extends AnyFn>(name: string, fn: F): TestBuilder<F, C, R>
  target<O extends object, K extends FnKeys<O>>(obj: O, key: K): TestBuilder<MethodOf<O, K>, C, R>
  target<O extends object, K extends FnKeys<O>>(name: string, obj: O, key: K): TestBuilder<MethodOf<O, K>, C, R>
}
export declare class Test<R extends object = {}> implements TargetStage<R, R> {
  timeout(ms: number): TargetStage<R, R>
  retry(count: number): TargetStage<R, R>
  use<S extends object>(m: Middleware<R, S>): TargetStage<ExtendContext<R, S>, R>
  mock<O extends object, K extends FnKeys<O>>(obj: O, key: K, def: MockDef<MethodOf<O, K>>): TargetStage<R, R>
  target<F extends AnyFn>(fn: F): TestBuilder<F, R, R>
  target<F extends AnyFn>(name: string, fn: F): TestBuilder<F, R, R>
  target<O extends object, K extends FnKeys<O>>(obj: O, key: K): TestBuilder<MethodOf<O, K>, R, R>
  target<O extends object, K extends FnKeys<O>>(name: string, obj: O, key: K): TestBuilder<MethodOf<O, K>, R, R>
  group<S extends object>(m: Middleware<R, S>, children: GroupChildren<ExtendContext<R, S>>): GroupSuite<R, R>
  group<S extends object>(name: string, m: Middleware<R, S>, children: GroupChildren<ExtendContext<R, S>>): GroupSuite<R, R>
  group(children: GroupChildren<R>): GroupSuite<R, R>
  group(name: string, children: GroupChildren<R>): GroupSuite<R, R>
}

export interface ExecutionSettings<Self> {
  timeout(ms: number): Self
  retry(count: number): Self
}
export interface ExecutionConfig {
  readonly timeout?: number
  readonly retry?: number
}
export interface ResolvedExecutionConfig {
  readonly timeout: number
  readonly retry: number
}
export interface SourceLocation {
  readonly file: string
  readonly line: number
  readonly column: number
}
export interface RowBlueprint {
  readonly index: number
  readonly value: unknown
}

/** blueprintは値・参照・遅延評価する関数を保持する。 */
export type ValueBlueprint<V, C> =
  | { readonly kind: 'value'; readonly value: V }
  | { readonly kind: 'from-context'; readonly build: (ctx: Ctx<C>) => V }
export type TargetBlueprint<F extends AnyFn> =
  | { readonly kind: 'function'; readonly fn: F }
  | { readonly kind: 'method'; readonly object: object; readonly key: string; readonly fn: F }
export interface MiddlewareBlueprint<C = any, S extends object = any> {
  readonly kind: 'middleware'
  readonly run: MiddlewareFn<C, S>
  /** middlewareの定義で指定した前処理・後処理の期限。未指定はundefined。 */
  readonly timeout: number | undefined
}
export interface GroupMiddlewareBlueprint<C = any, S extends object = any> {
  readonly kind: 'middleware'
  readonly run: MiddlewareFn<C, S>
  readonly timeout: number | undefined
}
export type StepBlueprint = MiddlewareBlueprint
export type BehaviorAction =
  | { readonly kind: 'returns' | 'resolves'; readonly value: unknown }
  | { readonly kind: 'throws' | 'rejects'; readonly error: unknown }
  | { readonly kind: 'callsFake'; readonly fn: AnyFn }
export type BehaviorBlueprint = BehaviorAction | {
  readonly kind: 'sequence'
  readonly once: readonly [BehaviorAction, ...BehaviorAction[]]
  readonly fallback: BehaviorAction
}
export interface MockBlueprint {
  readonly object: object
  readonly key: string
  readonly behavior: BehaviorBlueprint
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
    | { readonly matcher: 'calledNthWith'; readonly n: number; readonly args: readonly unknown[] }
}
export type Assertion = ResultAssertion | ErrorAssertion
export type Assertions =
  | readonly [ResultAssertion, ...ResultAssertion[]]
  | readonly [ErrorAssertion, ...ErrorAssertion[]]
export interface ExpectationBlueprint<C> {
  readonly kind: 'deferred'
  /** 元のexpectコールバックにctxと記述子ビルダーを渡す処理。targetの後に評価する。 */
  readonly build: (ctx: Ctx<C>) => Assertions
}
export type ExecutableCase<F extends AnyFn, C> = {
  readonly name: string
  readonly mode: 'run' | 'only' | 'skip'
  readonly origin: SourceLocation
  readonly row: RowBlueprint | null
  readonly config: ExecutionConfig
  readonly mocks: readonly MockBlueprint[]
  readonly args: ValueBlueprint<Parameters<F>, C>
} & (
  | { readonly expect: ExpectationBlueprint<C>; readonly calls: readonly CallAssertion[] }
  | { readonly expect: null; readonly calls: CallExpectations }
)
export interface TodoCase {
  readonly name: string
  readonly mode: 'todo'
  readonly origin: SourceLocation
  readonly row: null
  readonly config: ExecutionConfig
}
interface BlueprintBase<R extends object> {
  readonly config: ExecutionConfig
  readonly [blueprintBrand]: (ctx: R) => void
  readonly version: 1
  readonly steps: readonly StepBlueprint[]
  readonly mocks: readonly MockBlueprint[]
}
export interface SuiteBlueprint<F extends AnyFn = AnyFn, C = any, R extends object = {}> extends BlueprintBase<R> {
  readonly kind: 'test'
  readonly name: string
  readonly target: TargetBlueprint<F>
  readonly cases: readonly (ExecutableCase<F, C> | TodoCase)[]
}
export interface GroupBlueprint<R extends object = {}> extends BlueprintBase<R> {
  readonly kind: 'group'
  readonly name: null
  readonly children: readonly GroupEntry[]
}
export interface GroupEntry {
  readonly origin: SourceLocation
  readonly name: string | null
  /** group(middleware, [children]) で子のまとまり全体を囲むmiddleware。指定しなければnull。 */
  readonly middleware: GroupMiddlewareBlueprint | null
  /** 子の要求型は階層内では隠す。取り出して単独実行はできない。 */
  readonly blueprint: TestBlueprint<never>
}
export type TestBlueprint<R extends object = {}> = SuiteBlueprint<AnyFn, any, R> | GroupBlueprint<R>
/** JSONにも同じ形で出す診断値。id/referenceは一つの診断値の中で対応する。 */
export type DiagnosticKey =
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'symbol'; readonly id: number; readonly description: string | null }
export interface DiagnosticProperty {
  readonly key: DiagnosticKey
  readonly value: DiagnosticValue
}
export type DiagnosticValue =
  | { readonly kind: 'undefined' | 'null' | 'hole' }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'number'; readonly value: number | 'NaN' | 'Infinity' | '-Infinity' | '-0' }
  | { readonly kind: 'bigint'; readonly value: string }
  | { readonly kind: 'symbol'; readonly id: number; readonly description: string | null }
  | { readonly kind: 'function'; readonly id: number; readonly name: string }
  | { readonly kind: 'array'; readonly id: number; readonly items: readonly DiagnosticValue[]; readonly properties: readonly DiagnosticProperty[] }
  | { readonly kind: 'object'; readonly id: number; readonly type: string; readonly properties: readonly DiagnosticProperty[]; readonly omitted: readonly string[] }
  | { readonly kind: 'date'; readonly id: number; readonly value: string | null }
  | { readonly kind: 'regexp'; readonly id: number; readonly source: string; readonly flags: string }
  | { readonly kind: 'map'; readonly id: number; readonly entries: readonly (readonly [DiagnosticValue, DiagnosticValue])[] }
  | { readonly kind: 'set'; readonly id: number; readonly values: readonly DiagnosticValue[] }
  | { readonly kind: 'reference'; readonly id: number }
  | { readonly kind: 'accessor'; readonly get: boolean; readonly set: boolean }
  | { readonly kind: 'omitted'; readonly reason: string }
export type ExecutionPhase = 'middleware' | 'instrumentation' | 'args' | 'target' | 'expect' | 'assertion' | 'cleanup'
/** middlewareの区間。前処理はnextを呼ぶまで、後処理はnextの完了後。 */
export type MiddlewareStage = 'before' | 'after'
export type AssertionReference = {
  readonly index: number
} & (
  | { readonly source: 'expect'; readonly subject: 'result'; readonly matcher: ResultAssertion['check']['matcher'] }
  | { readonly source: 'expect'; readonly subject: 'error'; readonly matcher: ErrorAssertion['check']['matcher'] }
  | { readonly source: 'expectCalls'; readonly subject: 'call'; readonly key: string; readonly matcher: CallAssertion['check']['matcher'] }
)
export interface TargetOutcome {
  readonly kind: 'return' | 'throw'
  readonly value: DiagnosticValue
}
export type Failure = {
  readonly message: string
} & (
  | { readonly kind: 'assertion'; readonly phase: 'assertion'; readonly assertion: AssertionReference; readonly expected: DiagnosticValue; readonly actual: DiagnosticValue }
  | { readonly kind: 'outcome'; readonly phase: 'target'; readonly expected: 'return' | 'throw'; readonly actual: TargetOutcome }
  | { readonly kind: 'execution'; readonly phase: ExecutionPhase; readonly cause: DiagnosticValue; readonly assertion?: AssertionReference }
  | { readonly kind: 'timeout'; readonly phase: ExecutionPhase; readonly timeoutMs: number; readonly cleanup: 'complete' | 'incomplete'; readonly stage?: MiddlewareStage }
)
export type AssertionResult = {
  readonly assertion: AssertionReference
} & (
  | { readonly status: 'passed'; readonly expected: DiagnosticValue; readonly actual: DiagnosticValue }
  | { readonly status: 'failed'; readonly expected: DiagnosticValue; readonly actual: DiagnosticValue }
  | { readonly status: 'not-evaluated'; readonly reason: string }
)
interface AttemptResultBase {
  readonly attempt: number
  readonly durationMs: number
  readonly outcome: TargetOutcome | null
}
export type PassedAttemptResult = AttemptResultBase & {
  readonly status: 'passed'
  readonly assertions: readonly Extract<AssertionResult, { status: 'passed' }>[]
  readonly failures: readonly []
  readonly cleanup: 'complete'
}
export type FailedAttemptResult = AttemptResultBase & {
  readonly status: 'failed'
  readonly assertions: readonly AssertionResult[]
  readonly failures: readonly [Failure, ...Failure[]]
  readonly cleanup: 'complete' | 'incomplete'
}
export type CancelledAttemptResult = AttemptResultBase & {
  readonly status: 'cancelled'
  readonly assertions: readonly Extract<AssertionResult, { status: 'passed' | 'not-evaluated' }>[]
  readonly failures: readonly []
  readonly cleanup: 'complete' | 'incomplete'
}
export type AttemptResult = PassedAttemptResult | FailedAttemptResult | CancelledAttemptResult
type RetriableFailedAttemptResult = FailedAttemptResult & { readonly cleanup: 'complete' }
export type CaseResult = {
  readonly name: string
  readonly origin: SourceLocation
  readonly path: readonly number[]
  readonly row: { readonly index: number; readonly value: DiagnosticValue } | null
  readonly config: ResolvedExecutionConfig
  readonly durationMs: number
} & (
  | { readonly attempts: readonly [...RetriableFailedAttemptResult[], PassedAttemptResult]; readonly notRun?: never }
  | { readonly attempts: readonly [...RetriableFailedAttemptResult[], FailedAttemptResult]; readonly notRun?: never }
  | { readonly attempts: readonly [...RetriableFailedAttemptResult[], CancelledAttemptResult]; readonly notRun?: never }
  | { readonly attempts: readonly []; readonly notRun: 'skipped' | 'todo' | 'cancelled' }
)
export interface TestResult {
  readonly kind: 'test'
  readonly name: string
  readonly path: readonly number[]
  readonly status: 'passed' | 'failed' | 'cancelled'
  readonly cases: readonly CaseResult[]
}
export type GroupMiddlewareFailure = {
  readonly message: string
  readonly phase: MiddlewareStage | 'contract'
} & (
  | { readonly kind: 'execution'; readonly cause: DiagnosticValue }
  | { readonly kind: 'timeout'; readonly timeoutMs: number }
)
export type GroupMiddlewareResult =
  | {
      readonly status: 'passed'
      readonly durationMs: number
      readonly failures: readonly []
      readonly cleanup: 'complete'
    }
  | {
      readonly status: 'failed'
      readonly durationMs: number
      readonly failures: readonly [GroupMiddlewareFailure, ...GroupMiddlewareFailure[]]
      readonly cleanup: 'complete' | 'incomplete'
    }
  | {
      readonly status: 'cancelled'
      readonly durationMs: number
      readonly failures: readonly []
      readonly cleanup: 'complete' | 'incomplete'
    }
  | {
      readonly status: 'not-run'
      readonly reason: 'no-runnable-cases' | 'cancelled'
      readonly durationMs: 0
      readonly failures: readonly []
      readonly cleanup: 'complete'
    }
export interface GroupResult {
  readonly kind: 'group'
  readonly name: null
  readonly path: readonly number[]
  readonly status: 'passed' | 'failed' | 'cancelled'
  readonly children: readonly {
    readonly name: string | null
    readonly origin: SourceLocation
    readonly middleware: GroupMiddlewareResult | null
    readonly result: TestResult | GroupResult
  }[]
}
interface RunResultBase {
  readonly version: 1
  readonly tests: readonly (TestResult | GroupResult)[]
}
export type RunResult = RunResultBase & (
  | { readonly status: 'passed'; readonly reason: 'completed' }
  | { readonly status: 'failed'; readonly reason: 'completed' | 'timeout' | 'interrupted' | 'cleanup-failed' }
  | { readonly status: 'cancelled'; readonly reason: 'interrupted' }
)
export interface RunOptions {
  readonly forbidOnly?: boolean
  readonly failOnFlaky?: boolean
}
export declare function run(test: TestDefinition | readonly TestDefinition[], options?: RunOptions): Promise<RunResult>
export interface Config {
  readonly include?: readonly string[]
  readonly exclude?: readonly string[]
  readonly reporter?: 'pretty' | 'json'
  readonly collectionTimeout?: number
  readonly shutdownGrace?: number
}
export declare function defineConfig(config: Config): Config
