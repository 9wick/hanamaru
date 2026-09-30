import type { SourceLocation } from '../../domain/definition/types.js'
import type { Value } from '../../foundation/value.js'

export interface ModulePreparation {
  id: string
  keys: string[]
}

export interface RootReference {
  file: string
  index: number
  origin: SourceLocation
}

export type ModuleInvoke = (name: string, args: Value[]) => Promise<Value>
