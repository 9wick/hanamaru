import { Injectable, inject } from '@zeltjs/core'
import type { RuntimeBlueprint } from '../../domain/definition/runtime.js'
import type { ExecutionNode } from '../../domain/execution/model.js'
import type { Value } from '../../foundation/value.js'
import type { Config } from './config.js'
import type { ModuleSession } from '../ports/collection-host.js'
import { ModuleToolchain } from '../ports/collection-host.js'

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
