const references = new WeakMap()

export function registerModule(namespace, id) {
  references.set(namespace, id)
}

export function moduleIdentity(object) {
  return references.get(object)
}

export function collectModulePreparation(blueprints) {
  const modules = new Map()
  const collect = (items) => {
    for (const item of items) {
      const id = moduleIdentity(item.object)
      if (!id) {
        if (item.object[Symbol.toStringTag] === 'Module')
          throw new TypeError(`module was loaded outside the test runtime: ${item.key}`)
        continue
      }
      const keys = modules.get(id) ?? new Set()
      keys.add(item.key)
      modules.set(id, keys)
    }
  }
  const visit = (bp) => {
    collect(bp.mocks)
    if (bp.kind === 'test') {
      for (const item of bp.cases) {
        if (item.mode === 'todo') continue
        collect(item.mocks)
        collect(item.calls)
      }
    } else for (const child of bp.children) visit(bp.kind === 'group' ? child.blueprint : child)
  }
  blueprints.forEach(visit)
  return [...modules].map(([id, keys]) => ({ id, keys: [...keys] }))
}
