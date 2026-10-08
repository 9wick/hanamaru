import type { Resource } from './resource.js'
import type { AnyFn } from '../../foundation/functions.js'
import type { Value } from '../../foundation/value.js'
import type { Assertions, CallAssertion, CallExpectations } from '../assertion/types.js'
import type { ExecutionConfig } from '../execution/config.js'

export declare const definitionBrand: unique symbol

declare const blueprintBrand: unique symbol

declare const middlewareBrand: unique symbol

export type InputPhase = 'attempt' | 'group'

export interface DefinitionHandle<R extends object, P extends InputPhase> {
  /** 要求する値と、配置から推論した最初の使用時点を保持する。 */
  readonly [definitionBrand]: {
    readonly input: (ctx: R) => void
    readonly phase: P
  }
  blueprint(): TestBlueprint<R>
}

/** run()やgroup()へ渡す完成したチェーンの値。要求は供給元によらず一つ。 */
export type TestDefinition<R extends object = {}> = DefinitionHandle<R, 'attempt'> | DefinitionHandle<R, 'group'>

export type ExtendContext<C, S> = C extends infer Current
  ? S extends infer Added
    ? Omit<Current, keyof Added> & Added
    : never
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

export type MiddlewareFn<C, S extends object> = (ctx: Ctx<C>, next: Next) => Promise<MiddlewareResult<S>>

export interface MiddlewareOptions {
  /** 前処理と後処理のそれぞれへ独立に適用する期限。 */
  readonly timeout?: number
}

export interface SourceLocation {
  readonly file: string
  readonly line: number
  readonly column: number
}

export interface RowBlueprint {
  readonly index: number
  readonly value: Value
}

/** blueprintは値・参照・遅延評価する関数を保持する。 */
export type ValueBlueprint<V, C> =
  | { readonly kind: 'value'; readonly value: V }
  | { readonly kind: 'from-context'; readonly build: (ctx: Ctx<C>) => V }

export type TargetBlueprint<F extends AnyFn> =
  | { readonly kind: 'function'; readonly fn: F }
  | { readonly kind: 'method'; readonly object: object; readonly key: string; readonly fn: F }

export interface MiddlewareBlueprint<C = object, S extends object = object> {
  readonly kind: 'middleware'
  readonly run: MiddlewareFn<C, S>
  /** middlewareの定義で指定した前処理・後処理の期限。未指定はundefined。 */
  readonly timeout: number | undefined
}

export interface GroupMiddlewareBlueprint<C = object, S extends object = object> {
  readonly kind: 'middleware'
  readonly run: MiddlewareFn<C, S>
  readonly timeout: number | undefined
}

export type StepBlueprint = MiddlewareBlueprint

export type BehaviorAction =
  | { readonly kind: 'returns' | 'resolves'; readonly value: Value }
  | { readonly kind: 'throws' | 'rejects'; readonly error: Value }
  | { readonly kind: 'callsFake'; readonly fn: AnyFn }

export type BehaviorBlueprint =
  | BehaviorAction
  | {
      readonly kind: 'sequence'
      readonly once: readonly [BehaviorAction, ...BehaviorAction[]]
      readonly fallback: BehaviorAction
    }

export interface MockBlueprint {
  readonly object: object
  readonly key: string
  readonly behavior: BehaviorBlueprint
}

export interface ExpectationBlueprint<C> {
  readonly kind: 'deferred'
  /** 元のexpectコールバックにctxと記述子ビルダーを渡す処理。targetの後に評価する。 */
  readonly build: (ctx: Ctx<C>) => Assertions
}

export type ExecutableCase<F extends AnyFn, C> = {
  readonly resources?: readonly Resource[]
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
  readonly resources?: readonly Resource[]
  readonly config: ExecutionConfig
  readonly [blueprintBrand]: (ctx: R) => void
  readonly version: 1
  readonly steps: readonly StepBlueprint[]
  readonly mocks: readonly MockBlueprint[]
}

export interface SuiteBlueprint<F extends AnyFn = AnyFn, C = object, R extends object = {}> extends BlueprintBase<R> {
  readonly kind: 'test'
  readonly name: string
  readonly target: TargetBlueprint<F>
  readonly cases: readonly (ExecutableCase<F, C> | TodoCase)[]
}

export interface GroupBlueprint<R extends object = {}> extends BlueprintBase<R> {
  readonly kind: 'group'
  readonly name: string | null
  readonly origin: SourceLocation
  readonly middleware: GroupMiddlewareBlueprint | null
  readonly children: readonly GroupEntry[]
}

/** new Test()から続くgroup呼び出しを保持する。実行階層のノードではない。 */
export interface DefinitionBlueprint<R extends object = {}> extends BlueprintBase<R> {
  readonly kind: 'definition'
  readonly children: readonly [GroupBlueprint<never>, ...GroupBlueprint<never>[]]
}

export interface GroupEntry {
  readonly origin: SourceLocation
  /** 子の要求型は階層内では隠す。取り出して単独実行はできない。 */
  readonly blueprint: TestBlueprint<never>
}

export interface ErasedSuiteBlueprint<R extends object = {}> extends BlueprintBase<R> {
  readonly kind: 'test'
  readonly name: string
  readonly target: TargetBlueprint<AnyFn>
  readonly cases: readonly (
    | TodoCase
    | {
        readonly resources?: readonly Resource[]
        readonly name: string
        readonly mode: 'run' | 'only' | 'skip'
        readonly origin: SourceLocation
        readonly row: RowBlueprint | null
        readonly config: ExecutionConfig
        readonly mocks: readonly MockBlueprint[]
        readonly args:
          | { readonly kind: 'value'; readonly value: readonly unknown[] }
          | { readonly kind: 'from-context'; readonly build: object }
        readonly expect: object | null
        readonly calls: readonly CallAssertion[]
      }
  )[]
}

export type TestBlueprint<R extends object = {}> = ErasedSuiteBlueprint<R> | GroupBlueprint<R> | DefinitionBlueprint<R>
