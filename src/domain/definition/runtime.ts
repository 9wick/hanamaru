import type { Resource } from './resource.js'
import type { AnyFn } from '../../foundation/functions.js'
import type { Value } from '../../foundation/value.js'
import type { RuntimeCallAssertion } from '../assertion/runtime.js'
import type { ExecutionConfig } from '../execution/config.js'
import { behaviorTag, definitionTag, doneTag, middlewareTag, resultTag } from './tags.js'
import type { BehaviorBlueprint, SourceLocation } from './types.js'

export type Fields = Record<PropertyKey, Value>

export type RuntimeBehavior = BehaviorBlueprint & { readonly [behaviorTag]?: true }

export interface RuntimeMiddlewareResult {
  readonly [resultTag]: true
  readonly fields: Fields
}

export interface RuntimeMiddleware {
  readonly [middlewareTag]: true
  readonly kind: 'middleware'
  readonly run: object
  readonly timeout: number | undefined
}

export interface RuntimeMock {
  object: object
  key: string
  behavior: RuntimeBehavior
  sourceObject?: object
}

export type RuntimeTarget = { kind: 'function'; fn: AnyFn } | { kind: 'method'; object: object; key: string; fn: AnyFn }

export type RuntimeArgs = { kind: 'value'; value: Value[] } | { kind: 'from-context'; build: object }

export interface RuntimeExpectation {
  kind: 'deferred'
  build: object
}

export interface CaseData {
  resources?: readonly Resource[]
  readonly [doneTag]?: true
  config: ExecutionConfig
  mocks: RuntimeMock[]
  args: RuntimeArgs | null
  expect: RuntimeExpectation | null
  calls: readonly RuntimeCallAssertion[]
}

export interface CaseBase {
  resources?: readonly Resource[]
  name: string
  origin: SourceLocation
  row: { index: number; value: Value } | null
  config: ExecutionConfig
  originalIndex?: number
}

export interface RuntimeCase extends CaseBase {
  mode: 'run' | 'only' | 'skip'
  mocks: RuntimeMock[]
  args: RuntimeArgs
  expect: RuntimeExpectation | null
  calls: readonly RuntimeCallAssertion[]
}

export interface RuntimeTodo extends CaseBase {
  mode: 'todo'
}

export type CaseBlueprint = RuntimeCase | RuntimeTodo

export interface BlueprintBase {
  resources?: readonly Resource[]
  version: 1
  config: ExecutionConfig
  steps: RuntimeMiddleware[]
  mocks: RuntimeMock[]
}

export interface RuntimeSuite extends BlueprintBase {
  kind: 'test'
  name: string
  target: RuntimeTarget
  cases: CaseBlueprint[]
}

export interface RuntimeGroup extends BlueprintBase {
  kind: 'group'
  name: string | null
  origin: SourceLocation
  middleware: RuntimeMiddleware | null
  children: { origin: SourceLocation; blueprint: RuntimeBlueprint }[]
}

export interface RuntimeDefinition extends BlueprintBase {
  kind: 'definition'
  children: RuntimeGroup[]
}

export type RuntimeBlueprint = RuntimeSuite | RuntimeGroup | RuntimeDefinition

/** 収集した定義の契約。tagは完成した定義だけが持つが、値を検査するまで型では決まらない。 */
export interface RuntimeDefinitionHandle {
  readonly [definitionTag]?: true
  blueprint(): RuntimeBlueprint
}

export interface DefinitionData {
  resources?: readonly Resource[]
  stage: 'base' | 'target' | 'suite' | 'group'
  config: ExecutionConfig
  steps: RuntimeMiddleware[]
  mocks: RuntimeMock[]
  groups: RuntimeGroup[]
  cases: CaseBlueprint[]
  target: RuntimeTarget | null
  name: string | null
}
