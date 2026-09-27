import { ModuleRunner, ESModulesEvaluator, ssrModuleExportsKey } from '@hanamaru/vite/module-runner'
import { moduleIdentity, registerModule } from './module-reference.js'

export function createModuleRuntime(invoke, preparation = []) {
  const slots = new Map(
    preparation.map(({ id, keys }) => [
      id,
      {
        keys: new Set(keys),
        values: Object.create(null),
        dispatchers: new Map(),
      },
    ]),
  )
  const views = new WeakMap()
  function view(id, original) {
    if (views.has(original)) return views.get(original)
    const slot = slots.get(id)
    const facade = new Proxy(Object.create(null), {
      get(_, key) {
        if (!slot?.keys.has(key)) return Reflect.get(original, key)
        if (!slot.dispatchers.has(key)) {
          const target = Reflect.get(original, key)
          if (typeof target !== 'function') return target
          const callOriginal = function (...args) {
            return Reflect.apply(original[key], this, args)
          }
          Object.defineProperty(slot.values, key, {
            value: callOriginal,
            writable: true,
            enumerable: true,
            configurable: true,
          })
          const dispatch = new Proxy(target, {
            apply: (_, receiver, args) => Reflect.apply(slot.values[key], receiver, args),
            construct(_, args, newTarget) {
              const implementation = slot.values[key] === callOriginal ? original[key] : slot.values[key]
              return Reflect.construct(implementation, args, newTarget === dispatch ? implementation : newTarget)
            },
          })
          slot.dispatchers.set(key, dispatch)
        }
        return slot.dispatchers.get(key)
      },
      has: (_, key) => Reflect.has(original, key),
      ownKeys: () => Reflect.ownKeys(original),
      getOwnPropertyDescriptor(_, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(original, key)
        return (
          descriptor && { enumerable: descriptor.enumerable, configurable: true, writable: true, value: facade[key] }
        )
      },
      set: () => false,
      defineProperty: () => false,
      deleteProperty: () => false,
    })
    views.set(original, facade)
    views.set(facade, facade)
    registerModule(facade, id)
    return facade
  }
  class Evaluator extends ESModulesEvaluator {
    async runInlinedModule(context, code, module) {
      // Cyclic imports must see the same dispatchers as imports after evaluation.
      module.exports = view(module.id, context[ssrModuleExportsKey])
      return super.runInlinedModule(context, code, module)
    }
  }
  class Runner extends ModuleRunner {
    processImport(exports, result, metadata) {
      if (!metadata?.isDynamicImport)
        for (const name of metadata?.importedNames ?? []) {
          if (!(name in exports))
            throw new SyntaxError(`The requested module '${result.url}' does not provide an export named '${name}'`)
        }
      return super.processImport(exports, result, metadata)
    }
    async directRequest(url, module, callstack) {
      const original = await super.directRequest(url, module, callstack)
      const facade = view(module.id, original)
      module.exports = facade
      return facade
    }
  }
  const runner = new Runner(
    {
      hmr: false,
      transport: {
        async invoke(payload) {
          return { result: await invoke(payload.data.name, payload.data.data) }
        },
      },
    },
    new Evaluator(),
  )
  const bindEntry = (entry) => {
    const id = moduleIdentity(entry.object)
    if (!id) return entry
    const slot = slots.get(id)
    if (!slot?.keys.has(entry.key)) throw new Error(`unprepared module mock: ${id}#${entry.key}`)
    void entry.object[entry.key]
    return { ...entry, object: slot.values, sourceObject: entry.object }
  }
  return {
    import: (file) => runner.import(file),
    close: () => runner.close(),
    bindNode: (node) => ({ ...node, mocks: node.mocks.map(bindEntry) }),
    bindCase: (item) => ({ ...item, mocks: item.mocks.map(bindEntry), calls: item.calls.map(bindEntry) }),
  }
}
