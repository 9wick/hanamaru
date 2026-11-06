import type { EvaluatedModuleNode, ModuleEvaluator, ModuleRunnerContext } from '@hanamaru/vite/module-runner'
import { ESModulesEvaluator, ssrImportMetaKey } from '@hanamaru/vite/module-runner'
import type { Value } from '../../foundation/value.js'
import { valueOf, objectValue } from '../../foundation/value.js'

/**
 * Viteの評価器に被せて、評価中のimport.metaへテストの入口を提供する。
 * 継承ではなく内側に持つことで、公開するのはViteが求める評価の口だけになる。
 */
export class TestModuleEvaluator implements ModuleEvaluator {
  readonly #inner = new ESModulesEvaluator()
  readonly #metaEntry: { readonly key: string; readonly url: string } | undefined
  #metaExports: Promise<Value> | undefined

  constructor(metaEntry?: { readonly key: string; readonly url: string }) {
    this.#metaEntry = metaEntry
  }

  get startOffset(): number {
    return this.#inner.startOffset
  }

  async runInlinedModule(
    context: ModuleRunnerContext,
    code: string,
    module?: Readonly<EvaluatedModuleNode>,
  ): Promise<Value> {
    if (!module) throw new Error('module evaluator requires a module node')
    if (this.#metaEntry) {
      this.#metaExports ??= import(this.#metaEntry.url).then(valueOf)
      Reflect.set(objectValue(context[ssrImportMetaKey]), this.#metaEntry.key, await this.#metaExports)
    }
    return valueOf(await this.#inner.runInlinedModule(context, code))
  }

  async runExternalModule(file: string): Promise<Value> {
    return valueOf(await this.#inner.runExternalModule(file))
  }
}
