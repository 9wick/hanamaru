import { pathToFileURL } from 'node:url'
import type { RuntimeCase } from '../../domain/definition/runtime.js'
import type { ExecutionNode } from '../../domain/execution/model.js'
import type { Value } from '../../foundation/value.js'
import type { ModuleFacades } from './facades.js'
import type { FacadeRunner } from './runner.js'

/** 組み立てたmodule runtime。差し替えの台帳を抱えるため、1つの実行につき1つだけ作る。 */
export class ModuleRuntime {
  readonly #runner: FacadeRunner
  readonly #facades: ModuleFacades
  #closing: Promise<void> | undefined

  constructor(runner: FacadeRunner, facades: ModuleFacades) {
    this.#runner = runner
    this.#facades = facades
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

  /** 期待の繋ぎ直しは関数値として渡されるため、thisを抱えたまま持ち出せる形にする。 */
  readonly bindCall = <T extends { object: object; key: string }>(entry: T): T & { sourceObject?: object } =>
    this.#facades.bind(entry)

  bindCase(item: RuntimeCase): RuntimeCase {
    return {
      ...item,
      mocks: item.mocks.map((entry) => this.#facades.bind(entry)),
      calls: item.calls.map((call) => (call.object === undefined ? call : this.#facades.bind(call))),
    }
  }
}
