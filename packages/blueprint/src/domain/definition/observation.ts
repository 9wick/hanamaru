import * as v from 'valibot'
import type { AnyFn } from './target-types.js'
import type { Value } from './javascript.js'

const evidenceValues = ['real-effect', 'substitute-effect', 'call-record'] as const
export type Evidence = (typeof evidenceValues)[number]
const evidenceSchema = v.picklist(evidenceValues)
declare const stateType: unique symbol
declare const actionType: unique symbol
export interface State<F extends AnyFn = AnyFn> {
  readonly kind: 'state'
  readonly [stateType]: F
}
export interface Action<E = Value> {
  readonly kind: 'action'
  readonly [actionType]: E
}
export interface ActionSession<E> {
  finish(): readonly E[] | Promise<readonly E[]>
  dispose(): void | Promise<void>
}
export interface ObservationScope {
  state<F extends AnyFn>(definition: { readonly evidence: Evidence; readonly read: F }): State<F>
  action<E>(definition: {
    readonly evidence: Evidence
    readonly open: () => ActionSession<E> | Promise<ActionSession<E>>
  }): Action<E>
}

/** 評価とトークンの所有者。propertyの候補を跨ぐ再利用は認めない。 */
export class ObservationOwner {
  #closed = false
  #next = 0
  assertOpen(): void {
    if (this.#closed) throw new TypeError('observation belongs to a completed evaluation')
  }
  allocate(): number {
    this.assertOpen()
    return this.#next++
  }
  close(): void {
    this.assertOpen()
    this.#closed = true
  }
}

export class StateDescriptor implements State<never> {
  readonly kind = 'state'
  declare readonly [stateType]: never
  readonly owner: ObservationOwner
  readonly id: number
  readonly evidence: Evidence
  readonly read: object
  constructor(owner: ObservationOwner, evidence: Evidence, read: object) {
    this.owner = owner
    this.id = owner.allocate()
    this.evidence = v.parse(evidenceSchema, evidence)
    this.read = v.parse(v.function(), read)
    Object.freeze(this)
  }
}
export class ActionDescriptor implements Action<never> {
  readonly kind = 'action'
  declare readonly [actionType]: never
  readonly owner: ObservationOwner
  readonly id: number
  readonly evidence: Evidence
  readonly open: object
  constructor(owner: ObservationOwner, evidence: Evidence, open: object) {
    this.owner = owner
    this.id = owner.allocate()
    this.evidence = v.parse(evidenceSchema, evidence)
    this.open = v.parse(v.function(), open)
    Object.freeze(this)
  }
}

/** 各environmentの準備中だけ発行を許す。同じ評価の環境はownerを共有する。 */
export class ObservationIssuer implements ObservationScope {
  #sealed = false
  readonly #owner: ObservationOwner
  constructor(owner: ObservationOwner) {
    this.#owner = owner
  }
  #issuing(): void {
    this.#owner.assertOpen()
    if (this.#sealed) throw new TypeError('observation tokens must be created before next()')
  }
  stopIssuing(): void {
    this.#sealed = true
  }
  seal(): void {
    this.#issuing()
    this.#sealed = true
  }
  state<F extends AnyFn>(definition: { readonly evidence: Evidence; readonly read: F }): State<F> {
    this.#issuing()
    return new StateDescriptor(this.#owner, definition.evidence, definition.read)
  }
  action<E>(definition: {
    readonly evidence: Evidence
    readonly open: () => ActionSession<E> | Promise<ActionSession<E>>
  }): Action<E> {
    this.#issuing()
    return new ActionDescriptor(this.#owner, definition.evidence, definition.open)
  }
}

export function checkedState(input: Value, owner: ObservationOwner): StateDescriptor {
  owner.assertOpen()
  const token = v.parse(v.instance(StateDescriptor), input)
  if (token.owner !== owner) throw new TypeError('state belongs to another evaluation')
  return token
}
export function checkedAction(input: Value, owner: ObservationOwner): ActionDescriptor {
  owner.assertOpen()
  const token = v.parse(v.instance(ActionDescriptor), input)
  if (token.owner !== owner) throw new TypeError('action belongs to another evaluation')
  return token
}
