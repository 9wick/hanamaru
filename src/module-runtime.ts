import type {
  ModuleRunnerContext,
  EvaluatedModuleNode,
  ResolvedResult,
  SSRImportMetadata,
} from '@hanamaru/vite/module-runner'
import type { ModuleInvoke } from './protocol.js'
import type { AnyFn } from './api.js'
import type { ModulePreparation, ExecutionNode, RuntimeCase } from './internal.js'
type Namespace = Record<PropertyKey, unknown>
import { ModuleRunner, ESModulesEvaluator, ssrModuleExportsKey } from '@hanamaru/vite/module-runner'
import { moduleIdentity, registerModule } from './module-reference.js'

export function createModuleRuntime(invoke: ModuleInvoke, preparation: ModulePreparation[] = []) {
  const slots = new Map(
    preparation.map(({ id, keys }) => [
      id,
      {
        keys: new Set<PropertyKey>(keys),
        values: Object.create(null) as Record<PropertyKey, AnyFn>,
        dispatchers: new Map<PropertyKey, AnyFn>(),
      },
    ]),
  )
  const views = new WeakMap<object, Namespace>()
  function view(id: string, original: Namespace): Namespace {
    if (views.has(original)) return views.get(original)!
    const slot = slots.get(id)
    const facade: Namespace = new Proxy(Object.create(null) as Namespace, {
      get(_, key) {
        if (!slot?.keys.has(key)) return Reflect.get(original, key)
        if (!slot.dispatchers.has(key)) {
          const target = Reflect.get(original, key)
          if (typeof target !== 'function') return target
          const callOriginal = function (this: unknown, ...args: unknown[]) {
            return Reflect.apply(original[key] as AnyFn, this, args)
          }
          Object.defineProperty(slot.values, key, {
            value: callOriginal,
            writable: true,
            enumerable: true,
            configurable: true,
          })
          const dispatch: AnyFn = new Proxy(target as AnyFn, {
            apply: (_, receiver, args) => Reflect.apply(slot.values[key], receiver, args),
            construct(_, args, newTarget): object {
              const implementation = slot.values[key] === callOriginal ? original[key] : slot.values[key]
              return Reflect.construct(
                implementation as AnyFn,
                args,
                (newTarget === dispatch ? implementation : newTarget) as AnyFn,
              )
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
    override async runInlinedModule(
      context: ModuleRunnerContext,
      code: string,
      module?: Readonly<EvaluatedModuleNode>,
    ) {
      // Cyclic imports must see the same dispatchers as imports after evaluation.
      if (!module) throw new Error('module evaluator requires a module node')
      Reflect.set(module, 'exports', view(module.id, context[ssrModuleExportsKey]))
      return super.runInlinedModule(context, code)
    }
  }
  class Runner extends ModuleRunner {
    override async directRequest(url: string, module: EvaluatedModuleNode, callstack: string[]): Promise<Namespace> {
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
          if (payload.type !== 'custom' || payload.event !== 'vite:invoke')
            throw new Error('unexpected module transport payload')
          return { result: await invoke(payload.data.name, payload.data.data) }
        },
      },
    },
    new Evaluator(),
  )
  // Vite marks this extension point private in its declarations. Keep the adapter at the integration boundary.
  const processImport = Reflect.get(ModuleRunner.prototype, 'processImport') as (
    this: ModuleRunner,
    exports: Namespace,
    result: ResolvedResult,
    metadata?: SSRImportMetadata,
  ) => Namespace
  Reflect.defineProperty(runner, 'processImport', {
    value(exports: Namespace, result: ResolvedResult, metadata?: SSRImportMetadata) {
      if (!metadata?.isDynamicImport)
        for (const name of metadata?.importedNames ?? []) {
          if (!(name in exports))
            throw new SyntaxError(`The requested module '${result.url}' does not provide an export named '${name}'`)
        }
      return processImport.call(runner, exports, result, metadata)
    },
  })
  const bindEntry = <T extends { object: object; key: string }>(entry: T): T & { sourceObject?: object } => {
    const id = moduleIdentity(entry.object)
    if (!id) return entry
    const slot = slots.get(id)
    if (!slot?.keys.has(entry.key)) throw new Error(`unprepared module mock: ${id}#${entry.key}`)
    void Reflect.get(entry.object, entry.key)
    return { ...entry, object: slot.values, sourceObject: entry.object }
  }
  return {
    import: (file: string): Promise<Record<string, unknown>> => runner.import(file),
    close: () => runner.close(),
    bindNode: <N extends ExecutionNode>(node: N): N => ({ ...node, mocks: node.mocks.map(bindEntry) }),
    bindCase: (item: RuntimeCase): RuntimeCase => ({
      ...item,
      mocks: item.mocks.map(bindEntry),
      calls: item.calls.map(bindEntry),
    }),
  }
}
