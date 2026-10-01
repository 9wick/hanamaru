import type { Config } from '../../application/collection/config.js'
import type { ModuleToolchain } from '../../application/ports/collection-host.js'
import type { ModulePreparation, ModuleTransport } from '../../application/ports/module-loader.js'
import type { RuntimeBlueprint } from '../../domain/definition/runtime.js'
import type { ExecutionNode } from '../../domain/execution/model.js'
import type { Value } from '../../foundation/value.js'
import { ModuleCompiler } from '../modules/compiler.js'
import { FacadeEvaluator } from '../modules/evaluator.js'
import { ModuleFacades } from '../modules/facades.js'
import { collectModulePreparation, ModuleRegistry } from '../modules/reference.js'
import { FacadeRunner } from '../modules/runner.js'
import { TsconfigResolver } from '../modules/resolver.js'
import { ModuleRuntime } from '../modules/runtime.js'
import { describeExecutionPlan } from './plan-shape.js'

/**
 * 収集が使うtest runtime一式。資源を作る口と準備・指紋の算出は、
 * runtimeが組み立てたnamespaceの出自を覚える同じ台帳を見なければ噛み合わないため、1つの持ち主にまとめる。
 * 資源は選んだファイルが決まってからでなければ立てられないため、組み立てはここが受け持つ。
 */
export class WorkerModuleToolchain implements ModuleToolchain {
  readonly #runtimeURL: URL
  readonly #registry: ModuleRegistry

  constructor(runtimeURL: URL, registry: ModuleRegistry) {
    this.#runtimeURL = runtimeURL
    this.#registry = registry
  }

  async createCompiler(vite: Config['vite']): Promise<ModuleCompiler> {
    const compiler = new ModuleCompiler(new TsconfigResolver(), this.#runtimeURL)
    await compiler.start(vite)
    return compiler
  }

  createRuntime(transport: ModuleTransport): ModuleRuntime {
    const facades = new ModuleFacades(this.#registry)
    return new ModuleRuntime(new FacadeRunner(facades, new FacadeEvaluator(facades), transport), facades)
  }

  prepare(blueprints: RuntimeBlueprint[]): ModulePreparation[] {
    return collectModulePreparation(this.#registry, blueprints)
  }

  describe(nodes: ExecutionNode[]): Value {
    return describeExecutionPlan(this.#registry, nodes)
  }
}
