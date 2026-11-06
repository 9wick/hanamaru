import type { ScenarioMember, ScenarioFunctions, ScenarioReceivers } from '../../domain/definition/scenario.js'
import type { StepOutput, StepScope } from '../../domain/definition/steps.js'
import type { Characteristic } from '../../domain/definition/runtime.js'
import type {
  Ctx,
  DefinitionHandle,
  ErasedSuiteBlueprint,
  Environment,
  ExtendContext,
} from '../../domain/definition/types.js'
import type { Resource, ResourceFields } from '../../domain/definition/resource.js'
import type { Arbitrary } from '../../domain/definition/generation.js'
import type { PropertyOptions } from '../../domain/definition/property-input.js'
import type { ContractConditions } from '../../domain/assertion/compiled-checks.js'
import type { ExampleExpect, EffectExpect } from '../../domain/assertion/expectation.js'
import type { FinalValue, HasFinal, StepSubject, StepsProperty } from './property-builder.js'
import type { ItDone, Middleware } from './types.js'

type Members = Readonly<Record<string, ScenarioMember>>
interface Settings<T> {
  timeout(ms: number): T
  retry(count: number): T
}
type BaseExpect<C, M extends Characteristic, O> = M extends 'effectful'
  ? EffectExpect<() => FinalValue<O>, C>
  : ExampleExpect<() => FinalValue<O>, C>
type ScenarioExpect<C, M extends Characteristic, O> = Omit<BaseExpect<C, M, O>, 'result' | 'input' | 'error'> & {
  readonly result: StepSubject<O>
} & (HasFinal<O> extends false ? {} : Pick<BaseExpect<C, M, O>, 'error'>)
interface ScenarioExpected<C, M extends Characteristic, O> {
  expect(build: (e: ScenarioExpect<C, M, O>) => ContractConditions): ItDone
}
export interface ScenarioItBuilder<A extends Members, C, M extends Characteristic> extends Settings<
  ScenarioItBuilder<A, C, M>
> {
  steps<O extends StepOutput>(
    build: (s: StepScope<ScenarioFunctions<A>, C, null>) => O & (keyof O extends never ? never : unknown),
  ): ScenarioExpected<C, M, O>
}
interface ScenarioGenerated<A extends Members, C, M extends Characteristic, S extends readonly unknown[]> {
  steps<O extends StepOutput>(
    build: (s: StepScope<ScenarioFunctions<A>, C, S>) => O & (keyof O extends never ? never : unknown),
  ): StepsProperty<C, S, M, O>
}
interface ScenarioPropertyBuilder<A extends Members, C, M extends Characteristic> extends Settings<
  ScenarioPropertyBuilder<A, C, M>
> {
  forAll<S extends readonly unknown[]>(source: Arbitrary<S>, options?: PropertyOptions): ScenarioGenerated<A, C, M, S>
}
interface Cases<A extends Members, C, R extends object, M extends Characteristic> {
  it(name: string, body: (t: ScenarioItBuilder<A, C, M>) => ItDone): ScenarioSuite<A, C, R, M>
  only(name: string, body: (t: ScenarioItBuilder<A, C, M>) => ItDone): ScenarioSuite<A, C, R, M>
  skip(name: string, body: (t: ScenarioItBuilder<A, C, M>) => ItDone): ScenarioSuite<A, C, R, M>
  todo(name: string): ScenarioSuite<A, C, R, M>
  property(name: string, body: (p: ScenarioPropertyBuilder<A, C, M>) => ItDone): ScenarioSuite<A, C, R, M>
}
export interface ScenarioSuite<A extends Members, C, R extends object, M extends Characteristic>
  extends Cases<A, C, R, M>, DefinitionHandle<R, 'attempt'> {
  blueprint(): ErasedSuiteBlueprint<R> & { readonly characteristic: M }
}
export type ScenarioTestBuilder<
  A extends Members,
  C,
  R extends object = {},
  M extends Characteristic = 'pure',
  D extends boolean = false,
  B extends boolean = false,
> = {
  use<S extends object>(
    m: Middleware<C, S> | (M extends 'effectful' ? Environment<C, S> : never),
  ): ScenarioTestBuilder<A, ExtendContext<C, S>, R, M, D, B>
  require<T extends Resource>(r: T): ScenarioTestBuilder<A, ExtendContext<ResourceFields<T>, C>, R, M, D, B>
  timeout(ms: number): ScenarioTestBuilder<A, C, R, M, D, B>
  retry(count: number): ScenarioTestBuilder<A, C, R, M, D, B>
} & (D extends true
  ? {}
  : {
      pure(): ScenarioTestBuilder<A, C, R, 'pure', true, B>
      effectful(): ScenarioTestBuilder<A, C, R, 'effectful', true, B>
    }) &
  (keyof ScenarioReceivers<A> extends never
    ? Cases<A, C, R, M>
    : B extends true
      ? Cases<A, C, R, M>
      : { from(build: (ctx: Ctx<C>) => ScenarioReceivers<A>): ScenarioTestBuilder<A, C, R, M, D, true> })
