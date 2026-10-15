import type { RuntimeBlueprint } from '@hanamaru/blueprint/model'
import type { ExecutionNode } from '../../domain/execution/model.js'
import type { Value } from '../../domain/execution/javascript.js'
import type { ModulePreparation } from '@hanamaru/module-runtime/application/ports/module-loader'
/**
 * 開いたtest runtime一式。1回の収集ぶんの持ち場で、開いた資源は畳むところまでここが受け持つ。
 * prepareとdescribeは純粋な変換に見えるが、runtimeが組み立てたnamespaceの出自を知る台帳を見るため、
 * 資源を開く口と同じ持ち主でなければ噛み合わない。
 */
export interface ModuleSession {
  readonly entryURL?: string
  import(file: string): Promise<Value>
  invoke(name: string, args: Value[]): Promise<Value>
  prepare(blueprints: RuntimeBlueprint[]): ModulePreparation[]
  describe(nodes: ExecutionNode[]): Value
  close(): Promise<void>
}
