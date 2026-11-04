import type { Scenario, ScenarioMember } from '../../domain/definition/scenario.js'
import type { ScenarioTestBuilder } from './scenario-types.js'
import type { PropertyBuilder } from './property-builder.js'
import type { ContractConditions } from '../../domain/assertion/compiled-checks.js'
import type { ExampleExpect, EffectExpect } from '../../domain/assertion/expectation.js'
import type { Characteristic } from '../../domain/definition/runtime.js'
import type { Resource, ResourceFields } from '../../domain/definition/resource.js'
import { doneTag, middlewareTag } from '../../domain/definition/tags.js'
import type {
  Ctx,
  DefinitionBlueprint,
  DefinitionHandle,
  ExtendContext,
  Environment,
  InputPhase,
  MiddlewareFn,
  SuiteBlueprint,
  TestDefinition,
} from '../../domain/definition/types.js'
import { definitionBrand } from '../../domain/definition/types.js'
import type { AnyFn, FnKeys, MethodOf, ObjectReceiver } from '../../domain/definition/target-types.js'
import type { Value } from '../../domain/definition/javascript.js'

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

export type Expect<F extends AnyFn, C, M extends Characteristic = 'pure'> = M extends 'effectful'
  ? EffectExpect<F, C>
  : ExampleExpect<F, C>

export interface ItBuilder<F extends AnyFn, C, M extends Characteristic = 'pure'> extends ExecutionSettings<
  ItBuilder<F, C, M>
> {
  require<T extends Resource>(r: T): ItBuilder<F, ExtendContext<ResourceFields<T>, C>, M>
  args(...args: Parameters<F>): ItArgs<F, C, M>
  argsFrom(build: (ctx: Ctx<C>) => Parameters<F>): ItArgs<F, C, M>
}
export interface ItArgs<F extends AnyFn, C, M extends Characteristic = 'pure'> {
  expect(build: (e: Expect<F, C, M>) => ContractConditions): ItDone
}
export type ItExpected = ItDone

export interface CaseMethods<F extends AnyFn, C, R extends object = {}, M extends Characteristic = 'pure'> {
  property(name: string, body: (p: PropertyBuilder<F, C, M>) => ItDone): Suite<F, C, R, M>
  each<const Row>(
    name: string | ((row: NoInfer<Row>) => string),
    rows: readonly Row[],
    body: (t: ItBuilder<F, C, M>, row: NoInfer<Row>) => ItDone,
  ): Suite<F, C, R, M>
  it(name: string, body: (t: ItBuilder<F, C, M>) => ItDone): Suite<F, C, R, M>
  only(name: string, body: (t: ItBuilder<F, C, M>) => ItDone): Suite<F, C, R, M>
  skip(name: string, body: (t: ItBuilder<F, C, M>) => ItDone): Suite<F, C, R, M>
  todo(name: string): Suite<F, C, R, M>
}

export interface Suite<F extends AnyFn, C, R extends object = {}, M extends Characteristic = 'pure'>
  extends CaseMethods<F, C, R, M>, DefinitionHandle<R, 'attempt'> {
  blueprint(): SuiteBlueprint<F, C, R> & { readonly characteristic: M }
}

interface ConfigurableTest<F extends AnyFn, C, R extends object, M extends Characteristic, D extends boolean>
  extends CaseMethods<F, C, R, M>, ExecutionSettings<TestBuilder<F, C, R, M, D>> {
  require<T extends Resource>(r: T): TestBuilder<F, ExtendContext<ResourceFields<T>, C>, R, M, D>
  use<S extends object>(
    m: Middleware<C, S> | (M extends 'effectful' ? Environment<C, S> : never),
  ): TestBuilder<F, ExtendContext<C, S>, R, M, D>
}

export type InstanceTestBuilder<
  I extends object,
  K extends FnKeys<I>,
  C,
  R extends object = {},
  M extends Characteristic = 'pure',
  D extends boolean = false,
> = {
  from(build: (ctx: Ctx<C>) => I): TestBuilder<MethodOf<I, K>, C, R, M, D>
  use<S extends object>(
    m: Middleware<C, S> | (M extends 'effectful' ? Environment<C, S> : never),
  ): InstanceTestBuilder<I, K, ExtendContext<C, S>, R, M, D>
  require<T extends Resource>(r: T): InstanceTestBuilder<I, K, ExtendContext<ResourceFields<T>, C>, R, M, D>
  timeout(ms: number): InstanceTestBuilder<I, K, C, R, M, D>
  retry(count: number): InstanceTestBuilder<I, K, C, R, M, D>
} & (D extends true
  ? {}
  : {
      pure(): InstanceTestBuilder<I, K, C, R, 'pure', true>
      effectful(): InstanceTestBuilder<I, K, C, R, 'effectful', true>
    })

export type TestBuilder<
  F extends AnyFn,
  C,
  R extends object = {},
  M extends Characteristic = 'pure',
  D extends boolean = false,
> = ConfigurableTest<F, C, R, M, D> &
  (D extends true
    ? {}
    : {
        pure(): TestBuilder<F, C, R, 'pure', true>
        effectful(): TestBuilder<F, C, R, 'effectful', true>
      })

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
  target<F extends AnyFn>(fn: F): TestBuilder<F, C, R>
  target<F extends AnyFn>(name: string, fn: F): TestBuilder<F, C, R>
  target<A extends Readonly<Record<string, ScenarioMember>>>(subject: Scenario<A>): ScenarioTestBuilder<A, C, R>
  target<A extends Readonly<Record<string, ScenarioMember>>>(
    name: string,
    subject: Scenario<A>,
  ): ScenarioTestBuilder<A, C, R>
  target<I extends object, K extends FnKeys<I>>(
    ctor: abstract new (...args: never[]) => I,
    key: K,
  ): InstanceTestBuilder<I, K, C, R>
  target<I extends object, K extends FnKeys<I>>(
    name: string,
    ctor: abstract new (...args: never[]) => I,
    key: K,
  ): InstanceTestBuilder<I, K, C, R>
  target<O extends object, K extends FnKeys<O>>(obj: O & ObjectReceiver<O>, key: K): TestBuilder<MethodOf<O, K>, C, R>
  target<O extends object, K extends FnKeys<O>>(
    name: string,
    obj: O & ObjectReceiver<O>,
    key: K,
  ): TestBuilder<MethodOf<O, K>, C, R>
}

export type Test<R extends object = {}> = TargetStage<R, R>

export interface TestConstructor {
  new <R extends object = {}>(): Test<R>
}

export interface ExecutionSettings<Self> {
  timeout(ms: number): Self
  retry(count: number): Self
}
