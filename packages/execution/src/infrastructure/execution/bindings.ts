import type { RuntimeCase } from '@hanamaru/blueprint/model'
import type { ExecutionNode } from '../../domain/execution/model.js'
import type { RunningRuntime } from '@hanamaru/module-runtime/infrastructure/modules/runtime'

/** 実行データに含まれるmock/callの参照を、その実行環境の差し替え先へ結ぶ。 */
export function bindNode<N extends ExecutionNode>(runtime: RunningRuntime, node: N): N {
  return { ...node, mocks: node.mocks.map((entry) => runtime.bindCall(entry)) }
}

export function bindCase(runtime: RunningRuntime, item: RuntimeCase): RuntimeCase {
  return {
    ...item,
    mocks: item.mocks.map((entry) => runtime.bindCall(entry)),
    calls: item.calls.map((call) => (call.object === undefined ? call : runtime.bindCall(call))),
  }
}
