import type { Resource, ResourceFields } from '../../domain/definition/resource.js'
import type { Relation } from '../../domain/definition/relation.js'
import * as v from 'valibot'
import type { DeclarationEvent } from '../../application/declarations.js'
import {
  addCase,
  addGroup,
  caseAllowed,
  caseName,
  emptyCase,
  emptyDefinition,
  groupAllowed,
  groupArguments,
  selectTarget,
  settingAllowed,
  toBlueprint,
  todoCase,
  withMock,
  withRetry,
  withResource,
  withStep,
  withTimeout,
} from '../../domain/definition/construction.js'
import type { CaseBlueprint, DefinitionData, RuntimeBlueprint } from '../../domain/definition/runtime.js'
import { definitionTag, middlewareTag } from '../../domain/definition/tags.js'
import type { ExtendContext, MiddlewareFn, MiddlewareOptions, SourceLocation } from '../../domain/definition/types.js'
import { positive } from '../../domain/definition/conditions.js'
import type { AnyFn, FnKeys, MethodOf } from '../../domain/definition/target-types.js'
import type { Value } from '../../domain/definition/javascript.js'
import { arrayValue, invoke, required } from '../../domain/definition/javascript.js'
import { CaseBuilder, createMock } from './case-builder.js'
import type {
  ChildrenPhase,
  CompatibleChildren,
  FirstPhase,
  GroupChildren,
  GroupStage,
  ItBuilder,
  ItDone,
  Middleware,
  MockDef,
  RelationTestBuilder,
  Suite,
  TargetStage,
  TestBuilder,
  TestConstructor,
} from './types.js'

export function middleware<C, S extends object>(
  fn: MiddlewareFn<C, S>,
  options: MiddlewareOptions = {},
): Middleware<C, S> {
  if (typeof fn !== 'function') throw new TypeError('middleware requires a function')
  const timeout = options.timeout === undefined ? undefined : positive(options.timeout, 'middleware timeout')
  const value: Middleware<C, S> = { [middlewareTag]: true, kind: 'middleware', run: fn, timeout }
  return Object.freeze(value)
}

import { DefinitionBuilder, isDefinition } from '../../domain/definition/handle.js'

export function createTest(location: () => SourceLocation, record: (event: DeclarationEvent) => void): TestConstructor {
  class Chain<R extends object = {}, C extends object = R, F extends AnyFn = AnyFn> extends DefinitionBuilder {
    readonly #data: DefinitionData
    constructor(data: DefinitionData) {
      super(data.stage === 'group' || data.stage === 'suite')
      this.#data = data
    }
    /**
     * チェーンの遷移はここだけで作る。完成した定義の宣言位置は case / group の origin と同じ値を使い、
     * 未完成の遷移では location を評価しない。
     */
    #next(data: DefinitionData, origin: () => SourceLocation): Chain<R, C, F> {
      const next = new Chain<R, C, F>(data)
      if (next[definitionTag] === true) record({ kind: 'declared', definition: next, origin: origin() })
      if (this[definitionTag] === true) record({ kind: 'consumed', definition: this })
      return next
    }
    timeout(ms: number) {
      settingAllowed(this.#data)
      return this.#next(withTimeout(this.#data, ms), location)
    }
    retry(count: number) {
      settingAllowed(this.#data)
      return this.#next(withRetry(this.#data, count), location)
    }
    require<T extends Resource>(
      r: T,
    ): TargetStage<ExtendContext<ResourceFields<T>, C>, R, ExtendContext<ResourceFields<T>, R>>
    require(r: Resource): object {
      settingAllowed(this.#data)
      return this.#next(withResource(this.#data, r), location)
    }
    use<S extends object>(step: Middleware<C, S>): TargetStage<ExtendContext<C, S>, R>
    use(step: Middleware<C, object>): object {
      settingAllowed(this.#data)
      if (step?.[middlewareTag] !== true) throw new TypeError('use requires middleware()')
      return this.#next(withStep(this.#data, step), location)
    }
    mock<O extends object, K extends FnKeys<O>>(object: O, key: K, def: MockDef<MethodOf<O, K>>): Chain<R, C, F> {
      settingAllowed(this.#data)
      return this.#next(withMock(this.#data, createMock(object, key, def)), location)
    }
    target<T extends AnyFn>(fn: T): TestBuilder<T, C, R>
    target<T extends AnyFn>(name: string, fn: T): TestBuilder<T, C, R>
    target<M extends Record<string, AnyFn>>(subject: Relation<M>): RelationTestBuilder<M, C, R>
    target<M extends Record<string, AnyFn>>(name: string, subject: Relation<M>): RelationTestBuilder<M, C, R>
    target<O extends object, K extends FnKeys<O>>(obj: O, key: K): TestBuilder<MethodOf<O, K>, C, R>
    target<O extends object, K extends FnKeys<O>>(name: string, obj: O, key: K): TestBuilder<MethodOf<O, K>, C, R>
    target(...input: Value[]): object {
      return this.#next(selectTarget(this.#data, input), location)
    }
    #addCase(
      mode: CaseBlueprint['mode'],
      name: Value,
      body?: object,
      row: CaseBlueprint['row'] = null,
      origin = location(),
    ) {
      caseAllowed(this.#data)
      const label = caseName(name)
      let item: CaseBlueprint
      if (mode === 'todo') item = todoCase(label, origin)
      else {
        if (!body) throw new TypeError('case requires a body')
        const built = v.parse(
          v.instance(CaseBuilder),
          invoke(body, undefined, [new CaseBuilder<F, C>(emptyCase(), required(this.#data.target))]),
        )
        item = built.completed({ name: label, mode, origin, row }, required(this.#data.target))
      }
      return this.#next(addCase(this.#data, item), () => origin)
    }
    it(name: string, body: (t: ItBuilder<F, C>) => ItDone): Suite<F, C, R>
    it(name: string, body: object): object {
      return this.#addCase('run', name, body)
    }
    only(name: string, body: (t: ItBuilder<F, C>) => ItDone): Suite<F, C, R>
    only(name: string, body: object): object {
      return this.#addCase('only', name, body)
    }
    skip(name: string, body: (t: ItBuilder<F, C>) => ItDone): Suite<F, C, R>
    skip(name: string, body: object): object {
      return this.#addCase('skip', name, body)
    }
    todo(name: string): Suite<F, C, R>
    todo(name: string): object {
      return this.#addCase('todo', name)
    }
    each<const Row>(
      name: string | ((row: NoInfer<Row>) => string),
      rows: readonly Row[],
      body: (t: ItBuilder<F, C>, row: NoInfer<Row>) => ItDone,
    ): Suite<F, C, R>
    each(name: string | object, input: readonly Value[], body: object): object {
      const rows = arrayValue(input)
      if (!rows.length) throw new TypeError('each requires nonempty rows')
      const origin = location()
      return rows.reduce<Chain<R, C, F>>((test, row, index) => {
        const display =
          typeof name === 'string' ? `${name} [${index + 1}]` : v.parse(v.string(), invoke(name, undefined, [row]))
        return test.#addCase(
          'run',
          display,
          (builder: object) => invoke(body, undefined, [builder, row]),
          { index, value: row },
          origin,
        )
      }, this)
    }
    group<S extends object>(
      m: Middleware<R, S>,
      children: CompatibleChildren<ExtendContext<C, S>, ExtendContext<R, S>>,
    ): GroupStage<C, R, 'group'>
    group<S extends object>(
      name: string,
      m: Middleware<R, S>,
      children: CompatibleChildren<ExtendContext<C, S>, ExtendContext<R, S>>,
    ): GroupStage<C, R, 'group'>
    group<const D extends GroupChildren<C>>(children: D): GroupStage<C, R, FirstPhase<ChildrenPhase<D>>>
    group<const D extends GroupChildren<C>>(name: string, children: D): GroupStage<C, R, FirstPhase<ChildrenPhase<D>>>
    group(...input: Value[]): object {
      groupAllowed(this.#data)
      const origin = location()
      const { name, middleware: step, children: input0 } = groupArguments(input)
      const children = v.parse(v.array(v.instance(DefinitionBuilder)), input0)
      if (!children.length || children.some((child) => !isDefinition(child)))
        throw new TypeError('group requires completed children')
      for (const child of children) record({ kind: 'consumed', definition: child })
      const entries = children.map((child) => ({ origin, blueprint: child.blueprint() }))
      return this.#next(addGroup(this.#data, { name, origin, middleware: step, children: entries }), () => origin)
    }
    override blueprint(): RuntimeBlueprint {
      return toBlueprint(this.#data)
    }
  }
  return class Test<R extends object = {}> extends Chain<R> {
    constructor() {
      super(emptyDefinition())
    }
  }
}
