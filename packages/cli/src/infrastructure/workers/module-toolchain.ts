import { Config, inject } from '@zeltjs/core'
import type { Config as ProjectConfig } from '../../application/collection/config.js'
import type { ModuleSession } from '../../application/ports/collection-host.js'
import { ModuleToolchain } from '../../application/ports/collection-host.js'
import type { ModulePreparation } from '@hanamaru/module-runtime/application/ports/module-loader'
import type { RuntimeBlueprint } from '@hanamaru/blueprint/model'
import type { ExecutionNode } from '@hanamaru/execution/domain/execution/model'
import type { Value } from '../../application/collection/javascript.js'
import type { RunningCompiler } from '@hanamaru/module-runtime/infrastructure/modules/compiler'
import { ModuleCompilerLauncher } from '@hanamaru/module-runtime/infrastructure/modules/compiler'
import { ExecutionModules } from '@hanamaru/execution/infrastructure/execution/modules'
import type { RunningRuntime } from '@hanamaru/module-runtime/infrastructure/modules/runtime'
import { ModuleRuntimeLauncher } from '@hanamaru/module-runtime/infrastructure/modules/runtime'

/**
 * 収集が開いたtest runtime一式。読み込みと取り寄せ、準備と指紋の算出を同じ持ち主にまとめる。
 * 畳む順は組み立てた順の逆で、runtimeを閉じてからcompilerを閉じる。
 */
class WorkerModuleSession implements ModuleSession {
  readonly #compiler: RunningCompiler
  readonly #runtime: RunningRuntime
  readonly #modules: ExecutionModules

  constructor(compiler: RunningCompiler, runtime: RunningRuntime, modules: ExecutionModules) {
    this.#compiler = compiler
    this.#runtime = runtime
    this.#modules = modules
  }

  import(file: string): Promise<Value> {
    return this.#runtime.import(file)
  }

  invoke(name: string, args: Value[]): Promise<Value> {
    return this.#compiler.invoke(name, args)
  }

  prepare(blueprints: RuntimeBlueprint[]): ModulePreparation[] {
    return this.#modules.prepare(blueprints)
  }

  describe(nodes: ExecutionNode[]): Value {
    return this.#modules.describe(nodes)
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
  readonly #modules: ExecutionModules

  constructor(
    compilers = inject(ModuleCompilerLauncher),
    runtimes = inject(ModuleRuntimeLauncher),
    modules = inject(ExecutionModules),
  ) {
    super()
    this.#compilers = compilers
    this.#runtimes = runtimes
    this.#modules = modules
  }

  async open(vite: ProjectConfig['vite']): Promise<ModuleSession> {
    const compiler = await this.#compilers.start(vite)
    // 収集は差し替えを行わない。宛先が決まるのは収集し終えた計画からで、据えるのは実行worker。
    return new WorkerModuleSession(compiler, this.#runtimes.start(compiler, []), this.#modules)
  }
}
