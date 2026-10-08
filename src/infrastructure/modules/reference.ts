import type { Resource } from '../../domain/definition/resource.js'
import { CallDescriptor, descriptor, plannedCalls } from '../../domain/definition/calls.js'
import { Injectable } from '@zeltjs/core'
import { indexExecutionNodes } from '../../application/execution/plan.js'
import type { ModulePreparation } from '../../application/ports/module-loader.js'
import type { RuntimeCallAssertion } from '../../domain/assertion/runtime.js'
import type { RuntimeBlueprint, RuntimeMock } from '../../domain/definition/runtime.js'
import type { BehaviorBlueprint } from '../../domain/definition/types.js'
import { defaultMiddlewareTimeoutMs } from '../../domain/execution/config.js'
import type { ExecutionNode } from '../../domain/execution/model.js'

type BehaviorShape = { kind: BehaviorBlueprint['kind']; once?: BehaviorShape[]; fallback?: BehaviorShape }

/**
 * module runtimeが組み立てたnamespaceの出自を覚える台帳。
 * 同じ台帳を見ている範囲だけが「test runtimeが読み込んだmodule」を見分けられるため、
 * runtimeを組み立てるworkerの入口が1つ持ち、準備の収集と計画の指紋もここが算出する。
 */
@Injectable()
export class ModuleRegistry {
  readonly #identities = new WeakMap<object, string>()

  register(namespace: object, id: string): void {
    this.#identities.set(namespace, id)
  }

  identify(namespace: object): string | undefined {
    return this.#identities.get(namespace)
  }

  /** 実行側が差し替えを据えるために要る、moduleごとの対象key。 */
  prepare(blueprints: RuntimeBlueprint[]): ModulePreparation[] {
    const modules = new Map<string, Set<string>>()
    const collect = (items: readonly (RuntimeMock | RuntimeCallAssertion)[]) => {
      for (const item of items) {
        if (item.object === undefined) continue
        const id = this.identify(item.object)
        if (!id) {
          if (Reflect.get(item.object, Symbol.toStringTag) === 'Module')
            throw new TypeError(`module was loaded outside the test runtime: ${item.key}`)
          continue
        }
        const keys = modules.get(id) ?? new Set()
        keys.add(item.key)
        modules.set(id, keys)
      }
    }
    const visit = (bp: RuntimeBlueprint): void => {
      collect(bp.mocks)
      if (bp.kind === 'test') {
        for (const item of bp.cases) {
          if (item.mode === 'todo') continue
          collect(item.mocks)
          collect(item.calls)
        }
      } else if (bp.kind === 'group') for (const child of bp.children) visit(child.blueprint)
      else for (const child of bp.children) visit(child)
    }
    blueprints.forEach(visit)
    return [...modules].map(([id, keys]) => ({ id, keys: [...keys] }))
  }

  /** 収集と実行で定義が同じかを突き合わせる指紋。差し替えの宛先はmoduleの出自まで含めて見る。 */
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
    const objects = new Map<object, number>()
    const reference = ({ object, key }: { object?: object; key: string }) => {
      if (object === undefined) return { key, fromContext: true }
      if (!objects.has(object)) objects.set(object, objects.size)
      return { object: objects.get(object), key, module: this.identify(object) ?? null }
    }
    const behavior = (value: BehaviorBlueprint): BehaviorShape =>
      value.kind === 'sequence'
        ? { kind: value.kind, once: value.once.map(behavior), fallback: behavior(value.fallback) }
        : { kind: value.kind }
    const described = [...indexExecutionNodes(nodes)].map(([path, node]) => ({
      path,
      kind: node.kind,
      name: node.bp.name,
      config: node.config,
      resources: (node.resources ?? []).map(resourceId),
      frames: node.frames.map((frame) => frame.steps.map((step) => step.timeout ?? defaultMiddlewareTimeoutMs)),
      mocks: node.mocks.map((mock) => ({ ...reference(mock), behavior: behavior(mock.behavior) })),
      ...(node.kind === 'group'
        ? {
            middleware: node.bp.middleware
              ? { timeout: node.bp.middleware.timeout ?? defaultMiddlewareTimeoutMs }
              : null,
          }
        : {
            target:
              node.bp.target.kind === 'relation'
                ? { kind: 'relation', members: Object.keys(node.bp.target.members) }
                : node.bp.target.kind,
            cases: node.bp.cases.map((item) => ({
              name: item.name,
              mode: item.mode,
              resources: (item.resources ?? []).map(resourceId),
              config: item.config,
              origin: item.origin,
              ...(item.mode === 'todo'
                ? {}
                : {
                    args:
                      item.args.kind === 'calls'
                        ? {
                            kind: 'calls',
                            invocations: plannedCalls(item.args, node.bp.target).map((call) => ({
                              id: call.id,
                              member: call.member,
                              args: call.args.map((arg) => descriptor(arg)?.id ?? null),
                            })),
                            output:
                              item.args.output instanceof CallDescriptor
                                ? item.args.output.id
                                : Object.fromEntries(
                                    Object.entries(item.args.output).map(([name, call]) => [name, call.id]),
                                  ),
                          }
                        : item.args.kind,
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
    return resourceShapes.length
      ? { nodes: described, resources: resourceShapes.sort((a, b) => a.id - b.id) }
      : described
  }
}
