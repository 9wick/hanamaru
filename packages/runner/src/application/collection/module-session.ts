import { Injectable, inject } from '@zeltjs/core'
import type { RuntimeBlueprint } from '@hanamaru/blueprint/model'
import type { ExecutionNode } from '../../domain/execution/model.js'
import type { Value } from '../../domain/execution/javascript.js'
import type { ModuleOptions as Config } from '../execution/options.js'
import type { ModuleSession } from '../ports/module-host.js'
import { ModuleToolchain } from '../ports/module-host.js'

/** 収集とworkerへの変換要求が共有するtest runtimeを保持し、最後に一度閉じる。 */
@Injectable()
export class CollectionModules {
  readonly #toolchain: ModuleToolchain

  #session: ModuleSession | undefined

  constructor(toolchain = inject(ModuleToolchain)) {
    this.#toolchain = toolchain
  }

  async open(vite: Config['vite']): Promise<void> {
    if (this.#session) throw new Error('collection modules are already open')
    this.#session = await this.#toolchain.open(vite)
  }

  get #active(): ModuleSession {
    if (!this.#session) throw new Error('collection modules are not open')
    return this.#session
  }

  import(file: string): Promise<Value> {
    return this.#active.import(file)
  }

  get entryURL(): string | undefined {
    return this.#active.entryURL
  }

  invoke(name: string, args: Value[]): Promise<Value> {
    return this.#active.invoke(name, args)
  }

  prepare(blueprints: RuntimeBlueprint[]) {
    return this.#active.prepare(blueprints)
  }

  describe(nodes: ExecutionNode[]): Value {
    return this.#active.describe(nodes)
  }

  async close(): Promise<void> {
    const session = this.#session
    this.#session = undefined
    await session?.close()
  }
}
