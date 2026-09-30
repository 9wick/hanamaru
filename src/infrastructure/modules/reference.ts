import type { ModulePreparation } from '../../application/ports/module-loader.js'
import type { RuntimeCallAssertion } from '../../domain/assertion/runtime.js'
import type { RuntimeBlueprint, RuntimeMock } from '../../domain/definition/runtime.js'

const references = new WeakMap<object, string>()

export function registerModule(namespace: object, id: string) {
  references.set(namespace, id)
}

export function moduleIdentity(object: object) {
  return references.get(object)
}

export function collectModulePreparation(blueprints: RuntimeBlueprint[]): ModulePreparation[] {
  const modules = new Map<string, Set<string>>()
  const collect = (items: readonly (RuntimeMock | RuntimeCallAssertion)[]) => {
    for (const item of items) {
      if (item.object === undefined) continue
      const id = moduleIdentity(item.object)
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
