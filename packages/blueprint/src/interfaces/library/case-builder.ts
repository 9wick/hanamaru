import type { Resource, ResourceFields } from '../../domain/definition/resource.js'
import type { StepPlan } from '../../domain/definition/steps.js'
import { RuntimeReference } from '../../domain/assertion/references.js'
import type { ContractConditions } from '../../domain/assertion/compiled-checks.js'
import { expectation } from '../../domain/assertion/expectation.js'
import type { ObservationOwner } from '../../domain/definition/observation.js'
import type {
  Characteristic,
  CaseBlueprint,
  CaseData,
  Fields,
  RuntimeCase,
  RuntimeTarget,
} from '../../domain/definition/runtime.js'
import {
  caseDone,
  completedCase,
  withArgs,
  withExpectation,
  withRetry,
  withResource,
  withTimeout,
} from '../../domain/definition/construction.js'
import { doneTag } from '../../domain/definition/tags.js'
import type { SourceLocation, ExtendContext } from '../../domain/definition/types.js'
import type { AnyFn } from '../../domain/definition/target-types.js'
import { arrayValue, invoke } from '../../domain/definition/javascript.js'
import type { ItBuilder, Expect, ItArgs, ItDone } from './types.js'

export class CaseBuilder<F extends AnyFn, C> {
  readonly #data: CaseData
  readonly #target: RuntimeTarget
  constructor(data: CaseData, target: RuntimeTarget) {
    this.#data = data
    this.#target = target
  }
  get [doneTag](): true {
    return caseDone(this.#data)
  }
  completed(
    base: { name: string; mode: RuntimeCase['mode']; origin: SourceLocation; row: CaseBlueprint['row'] },
    target: RuntimeTarget,
  ): RuntimeCase {
    if (this.#target !== target) throw new TypeError('case definition belongs to another target')
    return completedCase(this.#data, base)
  }
  #next(data: CaseData): CaseBuilder<F, C> {
    return new CaseBuilder(data, this.#target)
  }
  timeout(ms: number) {
    if (this.#data.args || this.#data.expect) throw new TypeError('configure timeout before input')
    return this.#next(withTimeout(this.#data, ms))
  }
  retry(count: number) {
    if (this.#data.args || this.#data.expect) throw new TypeError('configure retry before input')
    return this.#next(withRetry(this.#data, count))
  }
  require<T extends Resource>(r: T): ItBuilder<F, ExtendContext<ResourceFields<T>, C>>
  require(r: Resource): object {
    return this.#next(withResource(this.#data, r))
  }
  args(...args: Parameters<F>): ItArgs<F, C> {
    if (this.#target.kind === 'scenario') throw new TypeError('operation collections require steps')
    return this.#next(withArgs(this.#data, { kind: 'value', value: arrayValue(args) }))
  }
  argsFrom(build: (ctx: Readonly<C>) => Parameters<F>): ItArgs<F, C> {
    if (this.#target.kind === 'scenario') throw new TypeError('operation collections require steps')
    return this.#next(withArgs(this.#data, { kind: 'from-context', build }))
  }
  steps(build: object): object {
    if (this.#target.kind !== 'scenario') throw new TypeError('it steps require a scenario target')
    if (this.#data.args !== null) throw new TypeError('steps is already set')
    if (typeof build !== 'function') throw new TypeError('steps requires a function')
    return this.#next(withArgs(this.#data, { kind: 'steps', build }))
  }
  expect(build: (e: Expect<F, C>) => ContractConditions): ItDone {
    return this.#next(
      withExpectation(
        this.#data,
        (ctx: Fields, owner: ObservationOwner, mode: Characteristic, plan: StepPlan | null) => {
          const source =
            plan === null
              ? undefined
              : plan.output instanceof RuntimeReference
                ? plan.output.source
                : ({ kind: 'record', fields: plan.output } as const)
          const e =
            mode === 'effectful'
              ? expectation(owner, ctx, 'effectful', source)
              : expectation(owner, ctx, 'pure', source)
          if (plan === null) return invoke(build, undefined, [e])
          const { input: _input, error, ...rest } = e
          return invoke(build, undefined, [Object.freeze(plan.final === null ? rest : { ...rest, error })])
        },
      ),
    )
  }
}
