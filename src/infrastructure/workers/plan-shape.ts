import { indexExecutionNodes } from '../../application/execution/plan.js'
import type { BehaviorBlueprint } from '../../domain/definition/types.js'
import { defaultMiddlewareTimeoutMs } from '../../domain/execution/config.js'
import type { ExecutionNode } from '../../domain/execution/model.js'
import { moduleIdentity } from '../modules/reference.js'

type BehaviorShape = { kind: BehaviorBlueprint['kind']; once?: BehaviorShape[]; fallback?: BehaviorShape }

export function describeExecutionPlan(nodes: ExecutionNode[]) {
  const objects = new Map<object, number>()
  const reference = ({ object, key }: { object?: object; key: string }) => {
    if (object === undefined) return { key, fromContext: true }
    if (!objects.has(object)) objects.set(object, objects.size)
    return { object: objects.get(object), key, module: moduleIdentity(object) ?? null }
  }
  const behavior = (value: BehaviorBlueprint): BehaviorShape =>
    value.kind === 'sequence'
      ? { kind: value.kind, once: value.once.map(behavior), fallback: behavior(value.fallback) }
      : { kind: value.kind }
  return [...indexExecutionNodes(nodes)].map(([path, node]) => ({
    path,
    kind: node.kind,
    name: node.bp.name,
    config: node.config,
    frames: node.frames.map((frame) => frame.steps.map((step) => step.timeout ?? defaultMiddlewareTimeoutMs)),
    mocks: node.mocks.map((mock) => ({ ...reference(mock), behavior: behavior(mock.behavior) })),
    ...(node.kind === 'group'
      ? {
          middleware: node.bp.middleware ? { timeout: node.bp.middleware.timeout ?? defaultMiddlewareTimeoutMs } : null,
        }
      : {
          target: node.bp.target.kind,
          cases: node.bp.cases.map((item) => ({
            name: item.name,
            mode: item.mode,
            config: item.config,
            origin: item.origin,
            ...(item.mode === 'todo'
              ? {}
              : {
                  args: item.args.kind,
                  mocks: item.mocks.map((mock) => ({ ...reference(mock), behavior: behavior(mock.behavior) })),
                  calls: item.calls.map((call) => ({
                    ...reference(call),
                    matcher: call.check.matcher,
                    argsFrom: 'argsFrom' in call.check,
                  })),
                }),
          })),
        }),
  }))
}
