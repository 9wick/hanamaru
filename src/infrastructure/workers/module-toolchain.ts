import { pathToFileURL } from 'node:url'
import type { Config } from '../../application/collection/config.js'
import type { CollectionRuntime, ModuleCompiler, ModuleToolchain } from '../../application/ports/collection-host.js'
import type { ModuleInvoke, ModulePreparation } from '../../application/ports/module-loader.js'
import type { RuntimeBlueprint } from '../../domain/definition/runtime.js'
import type { ExecutionNode } from '../../domain/execution/model.js'
import type { Value } from '../../foundation/value.js'
import { createModuleCompiler } from '../modules/compiler.js'
import { collectModulePreparation, ModuleRegistry } from '../modules/reference.js'
import { createModuleRuntime } from '../modules/runtime.js'
import { describeExecutionPlan } from './plan-shape.js'

/**
 * 収集が使うtest runtime一式。資源を作る口と準備・指紋の算出は、
 * runtimeが組み立てたnamespaceの出自を覚える同じ台帳を見なければ噛み合わないため、1つの持ち主にまとめる。
 */
export class WorkerModuleToolchain implements ModuleToolchain {
  readonly #runtimeURL: URL
  readonly #registry: ModuleRegistry

  constructor(runtimeURL: URL, registry: ModuleRegistry) {
    this.#runtimeURL = runtimeURL
    this.#registry = registry
  }

  createCompiler(vite: Config['vite']): Promise<ModuleCompiler> {
    return createModuleCompiler(this.#runtimeURL, vite)
  }

  createRuntime(invoke: ModuleInvoke): CollectionRuntime {
    const runtime = createModuleRuntime(this.#registry, invoke)
    return { import: (file) => runtime.import(pathToFileURL(file).href), close: () => runtime.close() }
  }

  prepare(blueprints: RuntimeBlueprint[]): ModulePreparation[] {
    return collectModulePreparation(this.#registry, blueprints)
  }

  describe(nodes: ExecutionNode[]): Value {
    return describeExecutionPlan(this.#registry, nodes)
  }
}
