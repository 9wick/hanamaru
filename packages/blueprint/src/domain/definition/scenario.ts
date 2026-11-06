import type { AnyFn, FnKeys, MethodOf } from './target-types.js'
import { functionValue, valueOf } from './javascript.js'

declare const methodType: unique symbol
export interface Method<F extends AnyFn, I extends object> {
  readonly [methodType]: { readonly fn: F; readonly instance: I }
}
export class MethodOperation {
  readonly ctor: object
  readonly key: string
  constructor(ctor: object, key: string) {
    if (typeof ctor !== 'function' || typeof key !== 'string')
      throw new TypeError('method requires a class and public method key')
    this.ctor = ctor
    this.key = key
    Object.freeze(this)
  }
}
export function method<I extends object, K extends FnKeys<I>>(
  ctor: abstract new (...args: never[]) => I,
  key: K,
): Method<MethodOf<I, K>, I>
export function method(ctor: object, key: string): object {
  return new MethodOperation(ctor, key)
}

export type ScenarioMember = AnyFn | Method<AnyFn, object>
export type ScenarioFunctions<M> = { [K in keyof M]: M[K] extends Method<infer F, object> ? F : Extract<M[K], AnyFn> }
export type ScenarioReceivers<M> = {
  [K in keyof M as M[K] extends Method<AnyFn, object> ? K : never]: M[K] extends Method<AnyFn, infer I> ? I : never
}
declare const scenarioType: unique symbol
export interface Scenario<M extends Readonly<Record<string, ScenarioMember>>> {
  readonly [scenarioType]: M
}
export class ScenarioDefinition {
  readonly kind = 'scenario'
  readonly members: Readonly<Record<string, AnyFn | MethodOperation>>
  constructor(members: object) {
    const entries = Reflect.ownKeys(members).map((key): [string, AnyFn | MethodOperation] => {
      if (typeof key !== 'string') throw new TypeError('scenario keys must be strings')
      const descriptor = Object.getOwnPropertyDescriptor(members, key)
      if (!descriptor || !('value' in descriptor)) throw new TypeError('scenario members must be data properties')
      const member = valueOf(descriptor.value)
      return [key, member instanceof MethodOperation ? member : functionValue(member)]
    })
    if (!entries.length) throw new TypeError('scenario requires at least one declared operation')
    this.members = Object.freeze(Object.fromEntries(entries))
    Object.freeze(this)
  }
}
export function scenario<const M extends Readonly<Record<string, ScenarioMember>>>(
  members: keyof M extends never ? never : M,
): Scenario<M>
export function scenario(members: object): object {
  return new ScenarioDefinition(members)
}
