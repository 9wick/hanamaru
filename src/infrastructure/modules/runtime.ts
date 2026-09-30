import type {
  EvaluatedModuleNode,
  ModuleRunnerContext,
  ResolvedResult,
  SSRImportMetadata,
} from '@hanamaru/vite/module-runner'
import { ESModulesEvaluator, ModuleRunner, ssrModuleExportsKey } from '@hanamaru/vite/module-runner'
import * as v from 'valibot'
import type { ModuleInvoke, ModulePreparation } from '../../application/ports/module-loader.js'
import type { RuntimeCase } from '../../domain/definition/runtime.js'
import type { ExecutionNode } from '../../domain/execution/model.js'
import type { AnyFn } from '../../foundation/functions.js'
import type { Value } from '../../foundation/value.js'
import {
  arrayValue,
  fieldsValue,
  functionValue,
  invoke as invokeFunction,
  objectValue,
  property,
  required,
  valueOf,
} from '../../foundation/value.js'
import { moduleIdentity, registerModule } from './reference.js'

type Namespace = Record<PropertyKey, Value>

export function createModuleRuntime(invoke: ModuleInvoke, preparation: ModulePreparation[] = []) {
  const slots = new Map(
    preparation.map(({ id, keys }) => [
      id,
      {
        keys: new Set<PropertyKey>(keys),
        values: fieldsValue(Object.create(null)),
        dispatchers: new Map<PropertyKey, AnyFn>(),
      },
    ]),
  )
  const views = new WeakMap<object, Namespace>()
  function view<T>(id: string, input: T): Namespace {
    const original = objectValue(valueOf(input))
    if (views.has(original)) return required(views.get(original))
    const slot = slots.get(id)
    const facade: Namespace = new Proxy(fieldsValue(Object.create(null)), {
      get(_, key) {
        if (!slot?.keys.has(key)) return property(original, key)
        if (!slot.dispatchers.has(key)) {
          const target = property(original, key)
          if (typeof target !== 'function') return target
          const callOriginal = function (this: Value, ...args: Value[]) {
            return invokeFunction(objectValue(property(original, key)), this, args)
          }
          Object.defineProperty(slot.values, key, {
            value: callOriginal,
            writable: true,
            enumerable: true,
            configurable: true,
          })
          const dispatch: AnyFn = new Proxy(functionValue(target), {
            apply: (_, receiver, args) =>
              invokeFunction(objectValue(slot.values[key]), valueOf(receiver), arrayValue(args)),
            construct(_, args, newTarget): object {
              const implementation = slot.values[key] === callOriginal ? property(original, key) : slot.values[key]
              return objectValue(
                valueOf(
                  Reflect.construct(
                    functionValue(implementation),
                    args,
                    functionValue(newTarget === dispatch ? implementation : newTarget),
                  ),
                ),
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
      return valueOf(await super.runInlinedModule(context, code))
    }
  }
  class Runner extends ModuleRunner {
    override async directRequest(url: string, module: EvaluatedModuleNode, callstack: string[]): Promise<Namespace> {
      const original = valueOf(await super.directRequest(url, module, callstack))
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
          const data = v.parse(
            v.object({ name: v.string(), data: v.array(v.union([v.string(), v.undefined(), v.looseObject({})])) }),
            payload.data,
          )
          return { result: await invoke(data.name, data.data) }
        },
      },
    },
    new Evaluator(),
  )
  // Vite marks this extension point private in its declarations. Keep the adapter at the integration boundary.
  const processImport = functionValue(property(ModuleRunner.prototype, 'processImport'))
  Reflect.defineProperty(runner, 'processImport', {
    value(exports: Namespace, result: ResolvedResult, metadata?: SSRImportMetadata) {
      if (!metadata?.isDynamicImport)
        for (const name of metadata?.importedNames ?? []) {
          if (!(name in exports))
            throw new SyntaxError(`The requested module '${result.url}' does not provide an export named '${name}'`)
        }
      return objectValue(invokeFunction(processImport, runner, [exports, result, metadata]))
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
    import: async (file: string): Promise<Record<string, Value>> => view(file, await runner.import(file)),
    close: () => runner.close(),
    bindNode: <N extends ExecutionNode>(node: N): N => ({ ...node, mocks: node.mocks.map(bindEntry) }),
    bindCall: bindEntry,
    bindCase: (item: RuntimeCase): RuntimeCase => ({
      ...item,
      mocks: item.mocks.map(bindEntry),
      calls: item.calls.map((call) => (call.object === undefined ? call : bindEntry(call))),
    }),
  }
}
