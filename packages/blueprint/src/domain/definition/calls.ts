import * as v from 'valibot'
import type { AnyFn } from './target-types.js'
import type { Value } from './javascript.js'
import { invoke, objectValue, property, valueOf } from './javascript.js'
import type { RuntimeTarget } from './runtime.js'

declare const callResult: unique symbol

/** 定義時の記述。Tは実行後の正常な戻り値の型で、実際の値は保持しない。 */
export interface CallRef<T> {
  readonly [callResult]: T
}

export type CallArguments<P extends readonly unknown[]> = { [K in keyof P]: P[K] | CallRef<P[K]> }

export interface InvocationBuilder<F extends AnyFn> {
  args(...args: CallArguments<Parameters<F>>): CallRef<Awaited<ReturnType<F>>>
}

export type RelationCalls<M extends Record<string, AnyFn>> = { readonly [K in keyof M]: InvocationBuilder<M[K]> }
export type CallOutput = CallRef<unknown> | Readonly<Record<string, CallRef<unknown>>>
export type CallsResult<O extends CallOutput> =
  O extends CallRef<infer T> ? T : { [K in keyof O]: O[K] extends CallRef<infer T> ? T : never }
export type NonemptyOutput<O extends CallOutput> = O extends CallRef<unknown> ? O : keyof O extends never ? never : O

/** 呼び出しのデータだけを持つ。scopeが別ケースの参照混入を防ぐ。 */
export class CallDescriptor implements CallRef<never> {
  declare readonly [callResult]: never
  readonly scope: object
  readonly id: number
  readonly member: string | null
  readonly args: readonly Value[]
  constructor(scope: object, id: number, member: string | null, args: readonly Value[]) {
    this.scope = scope
    this.id = id
    this.member = member
    this.args = args
    Object.freeze(args)
    Object.freeze(this)
  }
}

export interface CallPlan {
  readonly kind: 'calls'
  readonly target: RuntimeTarget
  readonly scope: object
  readonly output: CallDescriptor | Readonly<Record<string, CallDescriptor>>
}

export function descriptor(value: Value): CallDescriptor | null {
  const result = v.safeParse(v.instance(CallDescriptor), value)
  return result.success ? result.output : null
}

function outputOf(value: Value): CallPlan['output'] {
  const ref = descriptor(value)
  if (ref) return ref
  const record = objectValue(value)
  const prototype = valueOf(Object.getPrototypeOf(record))
  if ((prototype !== Object.prototype && prototype !== null) || !Reflect.ownKeys(record).length)
    throw new TypeError('calls must return a call reference or a nonempty named record of references')
  return Object.freeze(
    Object.fromEntries(
      Reflect.ownKeys(record).map((key) => {
        if (typeof key !== 'string') throw new TypeError('call result names must be strings')
        return [key, v.parse(v.instance(CallDescriptor), property(record, key))]
      }),
    ),
  )
}

export function callRoots(plan: CallPlan): readonly CallDescriptor[] {
  return plan.output instanceof CallDescriptor ? [plan.output] : Object.values(plan.output)
}

/** 結果へ到達する記述だけを、依存順に取り出す。対象関数は呼ばない。 */
export function plannedCalls(plan: CallPlan, target: RuntimeTarget): readonly CallDescriptor[] {
  if (plan.target !== target) throw new TypeError('calls definition belongs to another target')
  outputOf(plan.output)
  const complete = new Set<CallDescriptor>(),
    visiting = new Set<CallDescriptor>()
  const ordered: CallDescriptor[] = []
  const visit = (call: CallDescriptor) => {
    if (call.scope !== plan.scope) throw new TypeError('call reference belongs to another calls definition')
    if (
      target.kind === 'relation'
        ? call.member === null || !Object.hasOwn(target.members, call.member)
        : call.member !== null
    )
      throw new TypeError('call is outside the declared target')
    if (complete.has(call)) return
    if (visiting.has(call)) throw new TypeError('cyclic call references')
    visiting.add(call)
    for (const arg of call.args) {
      const dependency = descriptor(arg)
      if (dependency) visit(dependency)
    }
    visiting.delete(call)
    complete.add(call)
    ordered.push(call)
  }
  callRoots(plan).forEach(visit)
  return ordered
}

export function buildCallPlan(target: RuntimeTarget, build: object): CallPlan {
  const scope = Object.freeze({})
  let count = 0,
    active = true
  const builder = (member: string | null) =>
    Object.freeze({
      args: (...args: Value[]) => {
        if (!active) throw new TypeError('call builders are only available inside their calls callback')
        for (const arg of args) {
          const dependency = descriptor(arg)
          if (dependency && dependency.scope !== scope)
            throw new TypeError('call reference belongs to another calls definition')
        }
        return new CallDescriptor(scope, ++count, member, args)
      },
    })
  const calls =
    target.kind === 'relation'
      ? Object.freeze(Object.fromEntries(Object.keys(target.members).map((key) => [key, builder(key)])))
      : builder(null)
  let output: CallPlan['output']
  try {
    output = outputOf(invoke(build, undefined, [calls]))
  } finally {
    active = false
  }
  const plan: CallPlan = Object.freeze({ kind: 'calls', target, scope, output })
  plannedCalls(plan, target)
  return plan
}
