import type {
  StepOutput,
  StepScope,
  StepValue,
  CallRef,
  FinalStepRef,
  StepPlan,
} from '../../domain/definition/steps.js'
import { RuntimeReference } from '../../domain/assertion/references.js'
import type { Subject } from '../../domain/assertion/subjects.js'
import type { ContractConditions } from '../../domain/assertion/compiled-checks.js'
import { propertyExpectation } from '../../domain/assertion/property-expectation.js'
import type { EffectPropertyExpect, PropertyExpect } from '../../domain/assertion/property-expectation.js'
import type { Arbitrary } from '../../domain/definition/generation.js'
import { propertyInput } from '../../domain/definition/property-input.js'
import type { PropertyOptions } from '../../domain/definition/property-input.js'
import type { AnyFn } from '../../domain/definition/target-types.js'
import type {
  Characteristic,
  Fields,
  RuntimeCase,
  RuntimeGeneratedArgs,
  RuntimeTarget,
} from '../../domain/definition/runtime.js'
import type { Ctx, SourceLocation } from '../../domain/definition/types.js'
import type { ObservationOwner } from '../../domain/definition/observation.js'
import { invoke } from '../../domain/definition/javascript.js'
import { positive, retryCount } from '../../domain/definition/conditions.js'
import type { ExecutionConfig } from '../../domain/definition/conditions.js'
import type { ItDone } from './types.js'
import { doneTag } from '../../domain/definition/tags.js'

type Expectation<F extends AnyFn, C, S extends readonly unknown[], M extends Characteristic> = M extends 'effectful'
  ? EffectPropertyExpect<F, C, S>
  : PropertyExpect<F, C, S>
interface Settings<T> {
  timeout(ms: number): T
  retry(count: number): T
}
export interface PropertyBuilder<F extends AnyFn, C, M extends Characteristic> extends Settings<
  PropertyBuilder<F, C, M>
> {
  forAll<S extends readonly unknown[]>(
    source: Arbitrary<S>,
    options?: PropertyOptions,
  ): PropertyInputBuilder<F, C, S, M>
}
interface BoundProperty<F extends AnyFn, C, S extends readonly unknown[], M extends Characteristic> {
  expect(build: (e: Expectation<F, C, S, M>) => ContractConditions): ItDone
}
export type FinalValue<O> =
  O extends FinalStepRef<infer V>
    ? V
    : O extends CallRef<unknown>
      ? never
      : { [K in keyof O]: O[K] extends FinalStepRef<infer V> ? V : never }[keyof O]
export type HasFinal<O> =
  O extends FinalStepRef<unknown>
    ? true
    : O extends CallRef<unknown>
      ? false
      : Extract<O[keyof O], FinalStepRef<unknown>> extends never
        ? false
        : true
type ResultOrigin<O> = HasFinal<O> extends false ? 'record' : 'final-record'
export type StepSubject<O> =
  O extends CallRef<infer V>
    ? Subject<V, 'step'>
    : O extends FinalStepRef<infer V>
      ? Subject<V, 'result'>
      : Omit<Subject<StepValue<O>, ResultOrigin<O>>, 'field' | 'part' | 'toBe'> & {
          field<K extends keyof O>(key: K): StepSubject<O[K]>
          part<K extends keyof O>(key: K): StepSubject<O[K]>
        }
export type StepsExpect<C, S extends readonly unknown[], M extends Characteristic, O> = Omit<
  Expectation<() => FinalValue<O>, C, S, M>,
  'result' | 'input' | 'error' | 'outcome'
> & { readonly result: StepSubject<O> } & (HasFinal<O> extends false
    ? {}
    : Pick<Expectation<() => FinalValue<O>, C, S, M>, 'error' | 'outcome'>)
export interface StepsProperty<C, S extends readonly unknown[], M extends Characteristic, O> {
  expect(build: (e: StepsExpect<C, S, M, O>) => ContractConditions): ItDone
}

export type PropertyInputBuilder<F extends AnyFn, C, S extends readonly unknown[], M extends Characteristic> = {
  steps<O extends StepOutput>(
    build: (s: StepScope<{ target: F }, C, S>) => O & (keyof O extends never ? never : unknown),
  ): StepsProperty<C, S, M, O>
  argsFrom(build: (ctx: Ctx<C>, sample: S) => Parameters<F>): BoundProperty<F, C, S, M>
} & (S extends Parameters<F> ? Pick<BoundProperty<F, C, S, M>, 'expect'> : {})

/** 生成設定は定義時に確定し、環境とsampleを使う関数は評価時まで実行しない。 */
export class PropertyCaseBuilder {
  readonly #target: RuntimeTarget
  readonly #config: ExecutionConfig
  readonly #args: RuntimeGeneratedArgs | null
  readonly #expect: object | null
  constructor(
    target: RuntimeTarget,
    config: ExecutionConfig = {},
    args: RuntimeGeneratedArgs | null = null,
    expectation: object | null = null,
  ) {
    this.#target = target
    this.#config = config
    this.#args = args
    this.#expect = expectation
  }
  get [doneTag](): true {
    if (!this.#args || !this.#expect) throw new TypeError('property requires forAll and expect')
    return true
  }
  #open(): void {
    if (this.#expect) throw new TypeError('property is already complete')
  }
  timeout(ms: number): PropertyCaseBuilder {
    this.#open()
    if (this.#args) throw new TypeError('configure timeout before forAll')
    return new PropertyCaseBuilder(this.#target, { ...this.#config, timeout: positive(ms, 'timeout') }, this.#args)
  }
  retry(count: number): PropertyCaseBuilder {
    this.#open()
    if (this.#args) throw new TypeError('configure retry before forAll')
    return new PropertyCaseBuilder(this.#target, { ...this.#config, retry: retryCount(count) }, this.#args)
  }
  forAll(source: Arbitrary, options: PropertyOptions = {}): PropertyCaseBuilder {
    this.#open()
    if (this.#args) throw new TypeError('forAll is already set')
    return new PropertyCaseBuilder(this.#target, this.#config, {
      kind: 'generated',
      input: propertyInput(source, options),
      binding: { kind: 'sample' },
    })
  }
  argsFrom(build: object): PropertyCaseBuilder {
    this.#open()
    if (!this.#args) throw new TypeError('argsFrom requires forAll')
    if (this.#args.binding.kind !== 'sample') throw new TypeError('argsFrom or steps is already set')
    if (typeof build !== 'function') throw new TypeError('argsFrom requires a function')
    return new PropertyCaseBuilder(this.#target, this.#config, { ...this.#args, binding: { kind: 'args', build } })
  }
  steps(build: object): PropertyCaseBuilder {
    this.#open()
    if (!this.#args) throw new TypeError('steps requires forAll')
    if (this.#args.binding.kind !== 'sample') throw new TypeError('argsFrom and steps are mutually exclusive')
    if (typeof build !== 'function') throw new TypeError('steps requires a function')
    return new PropertyCaseBuilder(this.#target, this.#config, { ...this.#args, binding: { kind: 'steps', build } })
  }
  expect(build: object): PropertyCaseBuilder {
    this.#open()
    if (!this.#args) throw new TypeError('expect requires forAll')
    if (typeof build !== 'function') throw new TypeError('expect requires a function')
    return new PropertyCaseBuilder(
      this.#target,
      this.#config,
      this.#args,
      (ctx: Fields, owner: ObservationOwner, mode: Characteristic, plan: StepPlan | null) => {
        const source =
          plan === null
            ? undefined
            : plan.output instanceof RuntimeReference
              ? plan.output.source
              : ({ kind: 'record', fields: plan.output } as const)
        const e =
          mode === 'effectful'
            ? propertyExpectation(owner, ctx, 'effectful', source)
            : propertyExpectation(owner, ctx, 'pure', source)
        if (plan === null) return invoke(build, undefined, [e])
        const { input: _input, error, outcome, ...rest } = e
        return invoke(build, undefined, [Object.freeze(plan.final === null ? rest : { ...rest, error, outcome })])
      },
    )
  }
  completed(name: string, origin: SourceLocation, target: RuntimeTarget): RuntimeCase {
    if (target !== this.#target) throw new TypeError('property belongs to another target')
    if (!this.#args || !this.#expect) throw new TypeError('property requires forAll and expect')
    return {
      name,
      origin,
      mode: 'run',
      caseKind: 'property',
      row: null,
      config: this.#config,
      args: this.#args,
      expect: { kind: 'contract', build: this.#expect },
    }
  }
}
