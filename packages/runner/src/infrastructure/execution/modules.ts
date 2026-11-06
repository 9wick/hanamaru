import type { Resource } from '@hanamaru/blueprint/model'
import { targetShape, inputShape } from '@hanamaru/blueprint/model'
import { Injectable } from '@zeltjs/core'
import { indexExecutionNodes } from '../../application/execution/plan.js'
import { defaultMiddlewareTimeoutMs } from '../../domain/execution/config.js'
import type { ExecutionNode } from '../../domain/execution/model.js'

/** 収集側と実行側で定義構造を照合する。評価用コールバックは呼ばない。 */
@Injectable()
export class ExecutionModules {
  describe(nodes: ExecutionNode[]) {
    const resources = new Map<Resource, number>()
    const resourceShapes: { id: number; name: string; scope: string; timeout: number; require: number[] }[] = []
    const resourceId = (r: Resource): number => {
      const previous = resources.get(r)
      if (previous !== undefined) return previous
      const id = resources.size
      resources.set(r, id)
      const shape = {
        id,
        name: r.name,
        scope: r.scope,
        timeout: r.timeout ?? defaultMiddlewareTimeoutMs,
        require: r.require.map(resourceId),
      }
      resourceShapes.push(shape)
      return id
    }
    const described = [...indexExecutionNodes(nodes)].map(([path, node]) => ({
      path,
      kind: node.kind,
      name: node.bp.name,
      config: node.config,
      resources: (node.resources ?? []).map(resourceId),
      frames: node.frames.map((frame) =>
        frame.steps.map((step) => ({ kind: step.kind, timeout: step.timeout ?? defaultMiddlewareTimeoutMs })),
      ),
      ...(node.kind === 'group'
        ? {
            middleware: node.bp.middleware
              ? { timeout: node.bp.middleware.timeout ?? defaultMiddlewareTimeoutMs }
              : null,
          }
        : {
            characteristic: node.bp.characteristic,
            target: targetShape(node.bp.target),
            cases: node.bp.cases.map((item) => ({
              name: item.name,
              mode: item.mode,
              resources: (item.resources ?? []).map(resourceId),
              config: item.config,
              origin: item.origin,
              ...(item.mode === 'todo'
                ? { caseKind: 'todo' }
                : { caseKind: item.args.kind === 'generated' ? 'property' : 'example', input: inputShape(item.args) }),
            })),
          }),
    }))
    return resourceShapes.length
      ? { nodes: described, resources: resourceShapes.sort((a, b) => a.id - b.id) }
      : described
  }
}
