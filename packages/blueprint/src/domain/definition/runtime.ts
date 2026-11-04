import type { ScenarioDefinition } from './scenario.js'
import type { PropertyInput } from './property-input.js'
import type { Resource } from './resource.js'
import type { AnyFn } from './target-types.js'
import type { Value } from './javascript.js'
import type { ExecutionConfig } from './conditions.js'
import { definitionTag, doneTag, middlewareTag, resultTag } from './tags.js'
import type { SourceLocation } from './types.js'

export type Fields = Record<PropertyKey, Value>

export interface RuntimeMiddlewareResult {
  readonly [resultTag]: true
  readonly fields: Fields
}

export interface RuntimeMiddleware {
  readonly [middlewareTag]: true
  readonly kind: 'middleware' | 'environment'
  readonly run: object
  readonly timeout: number | undefined
}

export interface InstanceTarget {
  readonly kind: 'instance'
  readonly ctor: object
  readonly key: string
  readonly from: object | null
}

export interface ScenarioTarget {
  readonly kind: 'scenario'
  readonly members: ScenarioDefinition['members']
  readonly from: object | null
}
export interface RuntimeStepsArgs {
  readonly kind: 'steps'
  readonly build: object
}

export type RuntimeTarget =
  | ScenarioTarget
  | InstanceTarget
  | { kind: 'function'; fn: AnyFn }
  | { kind: 'method'; object: object; key: string; fn: AnyFn }

export interface RuntimeGeneratedArgs {
  readonly kind: 'generated'
  readonly input: PropertyInput
  readonly binding:
    | { readonly kind: 'sample' }
    | { readonly kind: 'args'; readonly build: object }
    | { readonly kind: 'steps'; readonly build: object }
}

export type RuntimeArgs =
  | RuntimeStepsArgs
  | RuntimeGeneratedArgs
  | { kind: 'value'; value: Value[] }
  | { kind: 'from-context'; build: object }

export interface RuntimeExpectation {
  kind: 'contract'
  build: object
}

export interface CaseData {
  resources?: readonly Resource[]
  readonly [doneTag]?: true
  config: ExecutionConfig
  args: RuntimeArgs | null
  expect: RuntimeExpectation | null
}

export interface CaseBase {
  resources?: readonly Resource[]
  name: string
  origin: SourceLocation
  row: { index: number; value: Value } | null
  config: ExecutionConfig
  originalIndex?: number
}

export type RuntimeCase = CaseBase & {
  mode: 'run' | 'only' | 'skip'
  expect: RuntimeExpectation
} & (
    | { caseKind: 'example'; args: Exclude<RuntimeArgs, RuntimeGeneratedArgs> }
    | { caseKind: 'property'; args: RuntimeGeneratedArgs }
  )
export interface RuntimeTodo extends CaseBase {
  caseKind: 'todo'
  mode: 'todo'
}

export type CaseBlueprint = RuntimeCase | RuntimeTodo

export interface BlueprintBase {
  resources?: readonly Resource[]
  version: 1
  config: ExecutionConfig
  steps: RuntimeMiddleware[]
}

export interface RuntimeSuite extends BlueprintBase {
  characteristic: Characteristic
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

export type Characteristic = 'pure' | 'effectful'

export interface DefinitionData {
  characteristic?: Characteristic
  resources?: readonly Resource[]
  stage: 'base' | 'target' | 'suite' | 'group'
  config: ExecutionConfig
  steps: RuntimeMiddleware[]
  groups: RuntimeGroup[]
  cases: CaseBlueprint[]
  target: RuntimeTarget | null
  name: string | null
}
