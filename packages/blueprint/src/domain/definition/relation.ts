import type { AnyFn } from './target-types.js'
import { functionValue, objectValue, property } from './javascript.js'

export const relationTag = Symbol('hanamaru.relation')

export interface Relation<M extends Record<string, AnyFn> = Record<string, AnyFn>> {
  readonly [relationTag]: true
  readonly kind: 'relation'
  readonly members: Readonly<M>
}

export function relation<const M extends Record<string, AnyFn>>(
  members: M & (keyof M extends never ? never : unknown) & Record<Exclude<keyof M, string>, never>,
): Relation<M>
export function relation(members: object): Relation {
  return relationValue(members)
}

function relationValue(members: object): Relation {
  const keys = Reflect.ownKeys(members)
  if (!keys.length || keys.some((key) => typeof key !== 'string' || typeof property(members, key) !== 'function'))
    throw new TypeError('relation requires a nonempty record of named functions')
  return Object.freeze({
    [relationTag]: true as const,
    kind: 'relation' as const,
    members: Object.freeze(Object.fromEntries(keys.map((key) => [key, functionValue(property(members, key))]))),
  })
}

export function checkedRelation(value: object): Relation {
  if (property(value, relationTag) !== true || property(value, 'kind') !== 'relation')
    throw new TypeError('target requires relation()')
  return relationValue(objectValue(property(value, 'members')))
}
