import { Config, inject } from '@zeltjs/core'
import type { Config as ProjectConfig } from '../../application/collection/config.js'
import type { ModuleSession } from '../../application/ports/collection-host.js'
import { ModuleToolchain } from '../../application/ports/collection-host.js'
import type { ModulePreparation } from '../../application/ports/module-loader.js'
import type { RuntimeBlueprint } from '../../domain/definition/runtime.js'
import type { ExecutionNode } from '../../domain/execution/model.js'
import type { Value } from '../../foundation/value.js'
import type { RunningCompiler } from '../modules/compiler.js'
import { ModuleCompilerLauncher } from '../modules/compiler.js'
import { ModuleRegistry } from '../modules/reference.js'
import type { RunningRuntime } from '../modules/runtime.js'
import { ModuleRuntimeLauncher } from '../modules/runtime.js'

/**
 * 収集が開いたtest runtime一式。読み込みと取り寄せ、準備と指紋の算出を同じ持ち主にまとめる。
 * 畳む順は組み立てた順の逆で、runtimeを閉じてからcompilerを閉じる。
 */
class WorkerModuleSession implements ModuleSession {
  readonly #compiler: RunningCompiler
  readonly #runtime: RunningRuntime
  readonly #registry: ModuleRegistry

  constructor(compiler: RunningCompiler, runtime: RunningRuntime, registry: ModuleRegistry) {
    this.#compiler = compiler
    this.#runtime = runtime
    this.#registry = registry
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

  /** runtimeを閉じられなくてもVite serverは残せない。 */
  async close(): Promise<void> {
    try {
      await this.#runtime.close()
    } finally {
      await this.#compiler.close()
    }
  }
}

/** 収集が使うtest runtimeの立ち上げ。読み込む相手は自分で立てたcompilerになる。 */
@Config()
export class WorkerModuleToolchain extends ModuleToolchain {
  readonly #compilers: ModuleCompilerLauncher
  readonly #runtimes: ModuleRuntimeLauncher
  readonly #registry: ModuleRegistry

  constructor(
    compilers = inject(ModuleCompilerLauncher),
    runtimes = inject(ModuleRuntimeLauncher),
    registry = inject(ModuleRegistry),
  ) {
    super()
    this.#compilers = compilers
    this.#runtimes = runtimes
    this.#registry = registry
  }

  async open(vite: ProjectConfig['vite']): Promise<ModuleSession> {
    const compiler = await this.#compilers.start(vite)
    // 収集は差し替えを行わない。宛先が決まるのは収集し終えた計画からで、据えるのは実行worker。
    return new WorkerModuleSession(compiler, this.#runtimes.start(compiler, []), this.#registry)
  }
}
