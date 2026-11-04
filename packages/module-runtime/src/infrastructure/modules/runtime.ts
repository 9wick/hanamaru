import { Injectable } from '@zeltjs/core'
import { pathToFileURL } from 'node:url'
import type { ModuleInvoke } from '../../application/ports/module-loader.js'
import type { Value } from '../../foundation/value.js'
import { TestModuleEvaluator } from './evaluator.js'
import { EvaluatedModuleRunner } from './runner.js'

/**
 * 組み立てたmodule runtime 1回ぶんの持ち場。
 * 評価した状態はこの持ち場に属するため、別の持ち場とは何も分け合わない。
 */
export class RunningRuntime {
  readonly #runner: EvaluatedModuleRunner
  #closing: Promise<void> | undefined

  constructor(runner: EvaluatedModuleRunner) {
    this.#runner = runner
  }

  /** 読み込む場所の表し方はpathでもURLでもよい。namespaceの見出しはViteが解決したmodule idに従う。 */
  async import(file: string): Promise<Record<string, Value>> {
    if (this.#closing) throw new Error('module runtime is closed')
    const url = file.startsWith('file:') ? file : pathToFileURL(file).href
    return this.#runner.import(url)
  }

  /** 二重に閉じても同じ約束を返す。閉じたあとの読み込みは受け付けない。 */
  close(): Promise<void> {
    this.#closing ??= this.#runner.close()
    return this.#closing
  }
}

/**
 * module runtimeを組み立てる。
 * 変換したコードの取り寄せ先とimport.metaの入口をstartで受け取る。
 */
@Injectable()
export class ModuleRuntimeLauncher {
  start(transport: ModuleInvoke, metaEntry?: { readonly key: string; readonly url: string }): RunningRuntime {
    return new RunningRuntime(new EvaluatedModuleRunner(new TestModuleEvaluator(metaEntry), transport))
  }
}
