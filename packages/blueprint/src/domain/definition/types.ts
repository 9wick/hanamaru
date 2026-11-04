import type { InstanceTarget, ScenarioTarget, RuntimeStepsArgs, RuntimeGeneratedArgs } from './runtime.js'
import type { ObservationOwner } from './observation.js'
import type { Characteristic } from './runtime.js'
import type { ObservationScope } from './observation.js'
import { middlewareTag } from './tags.js'
import type { Resource } from './resource.js'
import type { AnyFn } from './target-types.js'
import type { Value } from './javascript.js'
import type { ExecutionConfig } from './conditions.js'

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
  | ScenarioTarget
  | InstanceTarget
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

export type StepBlueprint = MiddlewareBlueprint | Environment

export interface ExpectationBlueprint<C> {
  readonly kind: 'contract'
  /** 環境準備後、targetより前に評価する期待ビルダー。 */
  readonly build: (ctx: Ctx<C>, owner: ObservationOwner, mode: Characteristic) => Value
}

export interface ExecutableCase<F extends AnyFn, C> {
  readonly resources?: readonly Resource[]
  readonly name: string
  readonly caseKind: 'example' | 'property'
  readonly mode: 'run' | 'only' | 'skip'
  readonly origin: SourceLocation
  readonly row: RowBlueprint | null
  readonly config: ExecutionConfig
  readonly args: ValueBlueprint<Parameters<F>, C> | RuntimeGeneratedArgs | RuntimeStepsArgs
  readonly expect: ExpectationBlueprint<C>
}

export interface TodoCase {
  readonly caseKind: 'todo'
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
}

export interface SuiteBlueprint<F extends AnyFn = AnyFn, C = object, R extends object = {}> extends BlueprintBase<R> {
  readonly kind: 'test'
  readonly characteristic: Characteristic
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
  readonly characteristic: Characteristic
  readonly name: string
  readonly target: TargetBlueprint<AnyFn>
  readonly cases: readonly (
    | TodoCase
    | {
        readonly resources?: readonly Resource[]
        readonly name: string
        readonly caseKind: 'example' | 'property'
        readonly mode: 'run' | 'only' | 'skip'
        readonly origin: SourceLocation
        readonly row: RowBlueprint | null
        readonly config: ExecutionConfig
        readonly args:
          | { readonly kind: 'value'; readonly value: readonly unknown[] }
          | { readonly kind: 'from-context'; readonly build: object }
          | RuntimeGeneratedArgs
          | RuntimeStepsArgs
        readonly expect: object
      }
  )[]
}

export type TestBlueprint<R extends object = {}> = ErasedSuiteBlueprint<R> | GroupBlueprint<R> | DefinitionBlueprint<R>

export type EnvironmentFn<C, S extends object> = (
  ctx: Ctx<C>,
  scope: ObservationScope,
  next: Next,
) => Promise<MiddlewareResult<S>>

export interface Environment<C = object, S extends object = object> {
  readonly [middlewareTag]: true
  readonly kind: 'environment'
  readonly run: EnvironmentFn<C, S>
  readonly timeout: number | undefined
}
