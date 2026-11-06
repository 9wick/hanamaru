import type { ExecutionNode } from '../../domain/execution/model.js'
import type { Value } from '../../domain/execution/javascript.js'
/**
 * 開いたtest runtime一式。1回の収集ぶんの持ち場で、開いた資源は畳むところまでここが受け持つ。
 * describeは読み込んだ定義の構造を照合するための情報を返す。
 */
export interface ModuleSession {
  readonly entryURL?: string
  import(file: string): Promise<Value>
  invoke(name: string, args: Value[]): Promise<Value>
  describe(nodes: ExecutionNode[]): Value
  close(): Promise<void>
}
