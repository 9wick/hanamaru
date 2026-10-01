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

/**
 * 変換したコードを取り寄せる口。収集workerは自分で立てたcompilerへ、実行workerは親のportへ繋ぐ。
 * module runtimeはどちらに繋がっているかを知らずに同じ形で頼む。
 */
export interface ModuleTransport {
  invoke: ModuleInvoke
}
