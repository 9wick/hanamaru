import type { Value } from '../../foundation/value.js'

export interface ModulePreparation {
  id: string
  keys: string[]
}

export type ModuleInvoke = (name: string, args: Value[]) => Promise<Value>
