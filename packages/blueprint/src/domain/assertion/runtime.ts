import type { Value } from '../definition/javascript.js'
import { assertionTag } from '../definition/tags.js'

export type ValueCheck =
  | { matcher: 'toBe' | 'toEqual' | 'toMatchObject'; expected: Value }
  | { matcher: 'toSatisfy'; predicate: object }
  | { matcher: 'toBeInstanceOf'; ctor: object }
  | { matcher: 'toThrow'; message: string | RegExp }

export type ResolvedCallCheck =
  | { matcher: 'calledTimes'; count: number }
  | { matcher: 'notCalled' }
  | { matcher: 'calledWith' | 'calledOnceWith'; args: readonly Value[] }
  | { matcher: 'calledNthWith'; n: number; args: readonly Value[] }

export interface RuntimeValueAssertion {
  readonly [assertionTag]: true
  subject: 'result' | 'error'
  readonly negated?: true
  check: ValueCheck
}

export type CallCheck =
  | ResolvedCallCheck
  | { matcher: 'calledWith' | 'calledOnceWith'; argsFrom: object }
  | { matcher: 'calledNthWith'; n: number; argsFrom: object }

export interface ResolvedCallAssertion {
  readonly [assertionTag]: true
  subject: 'call'
  check: ResolvedCallCheck
  object: object
  key: string
  sourceObject?: object
}

export type RuntimeCallAssertion = Omit<ResolvedCallAssertion, 'object' | 'check'> & { check: CallCheck } & (
    | { object: object; objectFrom?: never }
    | { objectFrom: object; object?: never }
  )

export type RuntimeAssertion = RuntimeValueAssertion | ResolvedCallAssertion
