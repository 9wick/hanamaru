import { Injectable, inject } from '@zeltjs/core'
import { pathToFileURL } from 'node:url'
import type { ModulePreparation, ModuleTransport } from '../../application/ports/module-loader.js'
import type { Value } from '../../foundation/value.js'
import { FacadeEvaluator } from './evaluator.js'
import { ModuleFacades } from './facades.js'
import { ModuleRegistry } from './reference.js'
import { FacadeRunner } from './runner.js'

/**
 * 組み立てたmodule runtime 1回ぶんの持ち場。
 * 評価した状態と差し替えの台帳はこの持ち場に属するため、別の持ち場とは何も分け合わない。
 */
export class RunningRuntime {
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

  bindCall<T extends { object: object; key: string }>(entry: T): T & { sourceObject?: object } {
    return this.#facades.bind(entry)
  }
}

/**
 * module runtimeを組み立てる。
 * 変換したコードの取り寄せ先も差し替える宛先も1回のrunごとに決まるため、どちらもstartで受け取る。
 */
@Injectable()
export class ModuleRuntimeLauncher {
  readonly #registry: ModuleRegistry

  constructor(registry = inject(ModuleRegistry)) {
    this.#registry = registry
  }

  start(transport: ModuleTransport, preparation: readonly ModulePreparation[]): RunningRuntime {
    const facades = new ModuleFacades(this.#registry, preparation)
    return new RunningRuntime(new FacadeRunner(facades, new FacadeEvaluator(facades), transport), facades)
  }
}
