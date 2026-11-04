import type { Value } from '../../foundation/value.js'

export type ModuleInvoke = (name: string, args: Value[]) => Promise<Value>
