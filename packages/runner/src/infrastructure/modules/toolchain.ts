import { Config, inject } from '@zeltjs/core'
import type { ModuleOptions as ProjectConfig } from '../../application/execution/options.js'
import type { ModuleSession } from '../../application/ports/module-host.js'
import { ModuleToolchain } from '../../application/ports/module-host.js'
import type { ModulePreparation } from '@hanamaru/module-runtime/application/ports/module-loader'
import type { RuntimeBlueprint } from '@hanamaru/blueprint/model'
import type { ExecutionNode } from '../../domain/execution/model.js'
import type { Value } from '../../domain/execution/javascript.js'
import type { RunningCompiler } from '@hanamaru/module-runtime/infrastructure/modules/compiler'
import { ModuleCompilerLauncher } from '@hanamaru/module-runtime/infrastructure/modules/compiler'
import { ExecutionModules } from '../execution/modules.js'
import type { RunningRuntime } from '@hanamaru/module-runtime/infrastructure/modules/runtime'
import { ModuleRuntimeLauncher } from '@hanamaru/module-runtime/infrastructure/modules/runtime'
import { ModuleEntry } from '@hanamaru/module-runtime/infrastructure/modules/entry'

/**
 * 収集が開いたtest runtime一式。読み込みと取り寄せ、準備と指紋の算出を同じ持ち主にまとめる。
 * 畳む順は組み立てた順の逆で、runtimeを閉じてからcompilerを閉じる。
 */
class WorkerModuleSession implements ModuleSession {
  readonly entryURL: string
  readonly #compiler: RunningCompiler
  readonly #runtime: RunningRuntime
  readonly #modules: ExecutionModules

  constructor(compiler: RunningCompiler, runtime: RunningRuntime, modules: ExecutionModules, entryURL: string) {
    this.#compiler = compiler
    this.#runtime = runtime
    this.#modules = modules
    this.entryURL = entryURL
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
  readonly #entry: ModuleEntry

  constructor(
    compilers = inject(ModuleCompilerLauncher),
    runtimes = inject(ModuleRuntimeLauncher),
    modules = inject(ExecutionModules),
    entry = inject(ModuleEntry),
  ) {
    super()
    this.#compilers = compilers
    this.#runtimes = runtimes
    this.#modules = modules
    this.#entry = entry
  }

  async open(vite: ProjectConfig['vite']): Promise<ModuleSession> {
    const compiler = await this.#compilers.start(vite)
    // 収集は差し替えを行わない。宛先が決まるのは収集し終えた計画からで、据えるのは実行worker。
    const entryURL = this.#entry.url.href
    return new WorkerModuleSession(
      compiler,
      this.#runtimes.start(compiler, [], { key: 'hanamaru', url: entryURL }),
      this.#modules,
      entryURL,
    )
  }
}
