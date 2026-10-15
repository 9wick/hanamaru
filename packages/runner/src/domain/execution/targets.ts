import type { SourceLocation } from '@hanamaru/blueprint/model'

export interface DefinitionTarget {
  readonly id: string
  readonly file: string
  readonly origin: SourceLocation
  readonly name: string
  readonly rootIndex: number
}
export interface CaseTarget {
  readonly id: string
  readonly definitionId: string
  readonly name: string
  readonly origin: SourceLocation
  readonly path: readonly number[]
  readonly caseIndex: number
  readonly mode: 'run' | 'only' | 'skip' | 'todo'
}
export interface TargetCatalogue {
  readonly version: 1
  readonly definitions: readonly DefinitionTarget[]
  readonly cases: readonly CaseTarget[]
}
export type TargetSelection =
  | { readonly kind: 'id'; readonly id: string }
  | { readonly kind: 'location'; readonly file: string; readonly line: number }
