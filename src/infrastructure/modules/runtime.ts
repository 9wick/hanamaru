import type { Lifecycle } from '@zeltjs/core'
import { Injectable, LifecycleManager, inject } from '@zeltjs/core'
import { pathToFileURL } from 'node:url'
import type { RuntimeCase } from '../../domain/definition/runtime.js'
import type { ExecutionNode } from '../../domain/execution/model.js'
import type { Value } from '../../foundation/value.js'
import { ModuleFacades } from './facades.js'
import { FacadeRunner } from './runner.js'

/** 組み立てたmodule runtime。差し替えの台帳を抱えるため、1つのscopeに1つだけ作る。 */
@Injectable()
export class ModuleRuntime implements Lifecycle {
  readonly #runner: FacadeRunner
  readonly #facades: ModuleFacades
  #closing: Promise<void> | undefined

  constructor(runner = inject(FacadeRunner), facades = inject(ModuleFacades), lifecycle = inject(LifecycleManager)) {
    this.#runner = runner
    this.#facades = facades
    // compilerより後に登録されるため、scopeの終了では runtime → compiler の順に畳まれる。
    lifecycle.register(this)
  }

  startup(): void {}

  shutdown(): Promise<void> {
    return this.close()
  }

  /** 読み込む場所の表し方はpathでもURLでもよい。namespaceの見出しはViteが解決したmodule idに従う。 */
  async import(file: string): Promise<Record<string, Value>> {
    if (this.#closing) throw new Error('module runtime is closed')
    const url = file.startsWith('file:') ? file : pathToFileURL(file).href
    return this.#facades.view(url, await this.#runner.import(url))
  }

  /** 二重に閉じても同じ約束を返す。閉じたあとの読み込みは受け付けない。 */
  close(): Promise<void> {
    this.#closing ??= this.#runner.close()
    return this.#closing
  }

  bindNode<N extends ExecutionNode>(node: N): N {
    return { ...node, mocks: node.mocks.map((entry) => this.#facades.bind(entry)) }
  }

  bindCall<T extends { object: object; key: string }>(entry: T): T & { sourceObject?: object } {
    return this.#facades.bind(entry)
  }

  bindCase(item: RuntimeCase): RuntimeCase {
    return {
      ...item,
      mocks: item.mocks.map((entry) => this.#facades.bind(entry)),
      calls: item.calls.map((call) => (call.object === undefined ? call : this.#facades.bind(call))),
    }
  }
}
