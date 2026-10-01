import { Config, inject } from '@zeltjs/core'
import type { Config as ProjectConfig } from '../../application/collection/config.js'
import { ModuleToolchain } from '../../application/ports/collection-host.js'
import type { ModulePreparation } from '../../application/ports/module-loader.js'
import type { RuntimeBlueprint } from '../../domain/definition/runtime.js'
import type { ExecutionNode } from '../../domain/execution/model.js'
import type { Value } from '../../foundation/value.js'
import { ModuleCompiler } from '../modules/compiler.js'
import { ModuleRegistry } from '../modules/reference.js'
import { ModuleRuntime } from '../modules/runtime.js'

/**
 * 収集が使うtest runtime一式。資源を開く口と準備・指紋の算出は、
 * runtimeが組み立てたnamespaceの出自を覚える同じ台帳を見なければ噛み合わないため、1つの持ち主にまとめる。
 */
@Config()
export class WorkerModuleToolchain extends ModuleToolchain {
  readonly #compiler: ModuleCompiler
  readonly #runtime: ModuleRuntime
  readonly #registry: ModuleRegistry

  constructor(compiler = inject(ModuleCompiler), runtime = inject(ModuleRuntime), registry = inject(ModuleRegistry)) {
    super()
    this.#compiler = compiler
    this.#runtime = runtime
    this.#registry = registry
  }

  start(vite: ProjectConfig['vite']): Promise<void> {
    return this.#compiler.start(vite)
  }

  import(file: string): Promise<Value> {
    return this.#runtime.import(file)
  }

  invoke(name: string, args: Value[]): Promise<Value> {
    return this.#compiler.invoke(name, args)
  }

  prepare(blueprints: RuntimeBlueprint[]): ModulePreparation[] {
    return this.#registry.prepare(blueprints)
  }

  describe(nodes: ExecutionNode[]): Value {
    return this.#registry.describe(nodes)
  }
}
