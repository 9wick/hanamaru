/** 公開APIの設計用型契約。フレームワークの実装・配布物ではない。 */
export type AnyFn = (...args: any[]) => any
export type FnKeys<O> = Extract<{
  [K in keyof O]-?: O[K] extends AnyFn ? K : never
}[keyof O], string>
export type MethodOf<O, K extends keyof O> = Extract<O[K], AnyFn>
export type Mocks = Record<string, AnyFn>
type IsUnion<T, Whole = T> = T extends Whole ? ([Whole] extends [T] ? false : true) : never
type NewName<N extends string, M> = string extends N ? never : true extends IsUnion<N> ? never : N extends keyof M ? never : N

declare const assertionBrand: unique symbol
declare const doneBrand: unique symbol
declare const definitionBrand: unique symbol
declare const behaviorBrand: unique symbol
declare const planBrand: unique symbol
export interface Assertion { readonly [assertionBrand]: true }
export type Assertions = readonly [Assertion, ...Assertion[]]
export interface ItDone { readonly [doneBrand]: true }
export interface TestDefinition { readonly [definitionBrand]: true }
export interface Behavior<F extends AnyFn, C> {
  readonly [behaviorBrand]: (fn: F, ctx: C) => readonly [F, C]
}
export interface SourceRef {
  readonly file: string
  readonly exportName: string
  readonly member?: string
}
export interface Location { readonly file: string; readonly line: number; readonly column: number }
export interface TargetOptions { readonly name?: string; readonly source?: SourceRef }
export interface CaseOptions { readonly id?: string; readonly source?: Location }

export interface BehaviorBuilder<F extends AnyFn, C> {
  returns(value: ReturnType<F>): Behavior<F, C>
  returnsFrom(label: string, value: (ctx: C) => ReturnType<F>): Behavior<F, C>
  resolves(value: ReturnType<F> extends PromiseLike<unknown> ? Awaited<ReturnType<F>> : never): Behavior<F, C>
  resolvesFrom(label: string, value: (ctx: C) => ReturnType<F> extends PromiseLike<unknown> ? Awaited<ReturnType<F>> : never): Behavior<F, C>
  throws(error: unknown): Behavior<F, C>
  rejects(error: ReturnType<F> extends PromiseLike<unknown> ? unknown : never): Behavior<F, C>
  callsFake(label: string, fn: F): Behavior<F, C>
  callsFakeFrom(label: string, fn: (ctx: C) => F): Behavior<F, C>
}
export type MockDef<F extends AnyFn, C> = (m: BehaviorBuilder<F, C>) => Behavior<F, C>
export interface ValueAssertions<V, C> {
  toBe(value: V): Assertion
  toBeFrom(label: string, value: (ctx: C) => V): Assertion
  toEqual(value: V): Assertion
  toEqualFrom(label: string, value: (ctx: C) => V): Assertion
  toMatchObject(value: V extends object ? Partial<V> : never): Assertion
  toSatisfy(label: string, predicate: (value: V, ctx: C) => boolean): Assertion
}
export interface ErrorAssertions<C> {
  toBeInstanceOf(ctor: new (...args: any[]) => object): Assertion
  toThrow(message: string | RegExp): Assertion
  toMatchObject(value: Record<string, unknown>): Assertion
  toSatisfy(label: string, predicate: (error: unknown, ctx: C) => boolean): Assertion
}
export interface MockAssertions<F extends AnyFn, C> {
  calledTimes(count: number): Assertion
  notCalled(): Assertion
  calledWith(...args: Parameters<F>): Assertion
  calledWithFrom(label: string, args: (ctx: C) => Parameters<F>): Assertion
  calledOnceWith(...args: Parameters<F>): Assertion
  calledOnceWithFrom(label: string, args: (ctx: C) => Parameters<F>): Assertion
}
export interface MockExpect<M extends Mocks, C> {
  mock<N extends keyof M & string>(name: N): MockAssertions<M[N], C>
}
export interface SuccessExpect<F extends AnyFn, M extends Mocks, C> extends MockExpect<M, C> {
  readonly result: ValueAssertions<Awaited<ReturnType<F>>, C>
}
export interface FailureExpect<M extends Mocks, C> extends MockExpect<M, C> {
  readonly error: ErrorAssertions<C>
}
export interface ItBuilder<F extends AnyFn, M extends Mocks, C> {
  mock<const N extends string, O, K extends FnKeys<O>>(name: NewName<N, M>, obj: O, key: K, def: MockDef<MethodOf<O, K>, C>): ItBuilder<F, M & Record<N, MethodOf<O, K>>, C>
  mockFrom<const N extends string, O, K extends string>(name: NewName<N, M>, get: (ctx: C) => O, key: K & FnKeys<NoInfer<O>>, def: MockDef<NoInfer<Extract<O[K & keyof O], AnyFn>>, C>): ItBuilder<F, M & Record<N, Extract<O[K & keyof O], AnyFn>>, C>
  override<N extends keyof M & string>(name: N, def: MockDef<M[N], C>): ItBuilder<F, M, C>
  args(...args: Parameters<F>): ItArgs<F, M, C>
  argsFrom(label: string, args: (ctx: C) => Parameters<F>): ItArgs<F, M, C>
}
export interface ItArgs<F extends AnyFn, M extends Mocks, C> {
  mock<const N extends string, O, K extends FnKeys<O>>(name: NewName<N, M>, obj: O, key: K, def: MockDef<MethodOf<O, K>, C>): ItArgs<F, M & Record<N, MethodOf<O, K>>, C>
  mockFrom<const N extends string, O, K extends string>(name: NewName<N, M>, get: (ctx: C) => O, key: K & FnKeys<NoInfer<O>>, def: MockDef<NoInfer<Extract<O[K & keyof O], AnyFn>>, C>): ItArgs<F, M & Record<N, Extract<O[K & keyof O], AnyFn>>, C>
  override<N extends keyof M & string>(name: N, def: MockDef<M[N], C>): ItArgs<F, M, C>
  expect(build?: (e: SuccessExpect<F, M, C>) => Assertions): ItDone
  expectError(build?: (e: FailureExpect<M, C>) => Assertions): ItDone
}
export interface CaseMethods<F extends AnyFn, M extends Mocks, C> {
  it(name: string, body: (t: ItBuilder<F, M, C>) => ItDone, options?: CaseOptions): Suite<F, M, C>
  only(name: string, body: (t: ItBuilder<F, M, C>) => ItDone, options?: CaseOptions): Suite<F, M, C>
  skip(name: string, body: (t: ItBuilder<F, M, C>) => ItDone, options?: CaseOptions): Suite<F, M, C>
  todo(name: string, options?: CaseOptions): Suite<F, M, C>
}
export interface Suite<F extends AnyFn, M extends Mocks, C> extends CaseMethods<F, M, C>, TestDefinition {
  plan(): TestPlan<F, C>
}
export interface TestBuilder<F extends AnyFn, M extends Mocks, C> extends CaseMethods<F, M, C> {
  describe(name: string): TestBuilder<F, M, C>
  mock<const N extends string, O, K extends FnKeys<O>>(name: NewName<N, M>, obj: O, key: K, def: MockDef<MethodOf<O, K>, C>): TestBuilder<F, M & Record<N, MethodOf<O, K>>, C>
  mockFrom<const N extends string, O, K extends string>(name: NewName<N, M>, get: (ctx: C) => O, key: K & FnKeys<NoInfer<O>>, def: MockDef<NoInfer<Extract<O[K & keyof O], AnyFn>>, C>): TestBuilder<F, M & Record<N, Extract<O[K & keyof O], AnyFn>>, C>
}
export interface TargetStage<C> {
  target<F extends AnyFn>(fn: F, options?: TargetOptions): TestBuilder<F, {}, C>
  target<O, K extends FnKeys<O>>(obj: O, key: K, options?: TargetOptions): TestBuilder<MethodOf<O, K>, {}, C>
  targetFrom<F extends AnyFn>(get: (ctx: C) => F, options: TargetOptions & { readonly name: string }): TestBuilder<F, {}, C>
}
export declare class Test implements TargetStage<{}> {
  setup<S>(create: () => S, dispose?: (ctx: Awaited<S>) => void | Promise<void>): TargetStage<Awaited<S>>
  target<F extends AnyFn>(fn: F, options?: TargetOptions): TestBuilder<F, {}, {}>
  target<O, K extends FnKeys<O>>(obj: O, key: K, options?: TargetOptions): TestBuilder<MethodOf<O, K>, {}, {}>
  targetFrom<F extends AnyFn>(get: (ctx: {}) => F, options: TargetOptions & { readonly name: string }): TestBuilder<F, {}, {}>
}

/** 実行計画には値・参照・遅延評価する関数をそのまま保持する。 */
export type ValuePlan<V, C> =
  | { readonly kind: 'value'; readonly value: V }
  | { readonly kind: 'from-context'; readonly label: string; readonly get: (ctx: C) => V }
export type TargetPlan<F extends AnyFn, C> = TargetOptions & (
  | { readonly kind: 'function'; readonly fn: F }
  | { readonly kind: 'method'; readonly object: object; readonly key: string; readonly fn: F }
  | { readonly kind: 'factory'; readonly name: string; readonly get: (ctx: C) => F }
)
export interface SetupPlan<C> {
  readonly create: () => C | Promise<C>
  readonly dispose?: (ctx: C) => void | Promise<void>
}
export type MockBinding<C> =
  | { readonly kind: 'method'; readonly object: object; readonly key: string }
  | { readonly kind: 'from-context'; readonly getObject: (ctx: C) => object; readonly key: string }
export type BehaviorPlan<C> =
  | { readonly kind: 'returns' | 'resolves'; readonly value: ValuePlan<unknown, C> }
  | { readonly kind: 'throws' | 'rejects'; readonly error: unknown }
  | { readonly kind: 'callsFake'; readonly label: string; readonly fn: ValuePlan<AnyFn, C> }
export interface MockPlan<C> {
  readonly name: string
  readonly binding: MockBinding<C>
  readonly behavior: BehaviorPlan<C>
}
export type ValueCheck<V, C> =
  | { readonly matcher: 'toBe' | 'toEqual'; readonly expected: ValuePlan<V, C> }
  | { readonly matcher: 'toMatchObject'; readonly expected: V extends object ? Partial<V> : never }
  | { readonly matcher: 'toSatisfy'; readonly label: string; readonly predicate: (value: V, ctx: C) => boolean }
export type ResultAssertion<V, C> = { readonly subject: 'result'; readonly check: ValueCheck<V, C> }
export type ErrorAssertion<C> = { readonly subject: 'error'; readonly check:
  | { readonly matcher: 'toBeInstanceOf'; readonly ctor: new (...args: any[]) => object }
  | { readonly matcher: 'toThrow'; readonly message: string | RegExp }
  | { readonly matcher: 'toMatchObject'; readonly expected: Record<string, unknown> }
  | { readonly matcher: 'toSatisfy'; readonly label: string; readonly predicate: (error: unknown, ctx: C) => boolean }
}
export type MockAssertion<C> = { readonly subject: 'mock'; readonly name: string; readonly check:
  | { readonly matcher: 'calledTimes'; readonly count: number }
  | { readonly matcher: 'notCalled' }
  | { readonly matcher: 'calledWith' | 'calledOnceWith'; readonly args: ValuePlan<readonly unknown[], C> }
}
export type OutcomePlan<F extends AnyFn, C> =
  | { readonly kind: 'return'; readonly assertions: readonly (ResultAssertion<Awaited<ReturnType<F>>, C> | MockAssertion<C>)[] }
  | { readonly kind: 'throw'; readonly assertions: readonly (ErrorAssertion<C> | MockAssertion<C>)[] }
export interface ExecutableCase<F extends AnyFn, C> {
  readonly id: string
  readonly name: string
  readonly mode: 'run' | 'only' | 'skip'
  readonly source?: Location
  readonly mocks: readonly MockPlan<C>[]
  readonly args: ValuePlan<Parameters<F>, C>
  readonly outcome: OutcomePlan<F, C>
}
export interface TodoCase {
  readonly id: string
  readonly name: string
  readonly mode: 'todo'
  readonly source?: Location
}
export interface TestPlan<F extends AnyFn = AnyFn, C = any> {
  readonly [planBrand]: true
  readonly version: 1
  readonly name: string
  readonly target: TargetPlan<F, C>
  readonly setup: SetupPlan<C> | null
  readonly cases: readonly (ExecutableCase<F, C> | TodoCase)[]
}
export interface Failure {
  readonly phase: 'setup' | 'binding' | 'mock' | 'args' | 'target' | 'assertion' | 'cleanup'
  readonly message: string
  readonly assertionIndex?: number
}
export interface CaseResult {
  readonly id: string
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
