import type { ModulePreparation } from '../../application/ports/module-loader.js'
import type { RuntimeCallAssertion } from '../../domain/assertion/runtime.js'
import type { RuntimeBlueprint, RuntimeMock } from '../../domain/definition/runtime.js'

/**
 * module runtimeが組み立てたnamespaceの出自を覚える台帳。
 * 同じ台帳を見ている範囲だけが「test runtimeが読み込んだmodule」を見分けられるため、
 * runtimeを組み立てるworkerの入口が1つ持ち、準備の収集と計画の指紋へ渡す。
 */
export class ModuleRegistry {
  readonly #identities = new WeakMap<object, string>()

  register(namespace: object, id: string): void {
    this.#identities.set(namespace, id)
  }

  identify(namespace: object): string | undefined {
    return this.#identities.get(namespace)
  }
}

export function collectModulePreparation(
  registry: ModuleRegistry,
  blueprints: RuntimeBlueprint[],
): ModulePreparation[] {
  const modules = new Map<string, Set<string>>()
  const collect = (items: readonly (RuntimeMock | RuntimeCallAssertion)[]) => {
    for (const item of items) {
      if (item.object === undefined) continue
      const id = registry.identify(item.object)
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
