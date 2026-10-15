import type { EvaluatedModuleNode, ModuleEvaluator, ModuleRunnerContext } from '@hanamaru/vite/module-runner'
import { ESModulesEvaluator, ssrModuleExportsKey, ssrImportMetaKey } from '@hanamaru/vite/module-runner'
import type { Value } from '../../foundation/value.js'
import { valueOf, objectValue } from '../../foundation/value.js'
import type { ModuleFacades } from './facades.js'

/**
 * Viteの評価器に被せて、評価中のmoduleのexportをnamespaceへ差し替える。
 * 継承ではなく内側に持つことで、公開するのはViteが求める評価の口だけになる。
 */
export class FacadeEvaluator implements ModuleEvaluator {
  readonly #inner = new ESModulesEvaluator()
  readonly #facades: ModuleFacades
  readonly #metaEntry: { readonly key: string; readonly url: string } | undefined
  #metaExports: Promise<Value> | undefined

  constructor(facades: ModuleFacades, metaEntry?: { readonly key: string; readonly url: string }) {
    this.#facades = facades
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
    // Cyclic imports must see the same dispatchers as imports after evaluation.
    if (!module) throw new Error('module evaluator requires a module node')
    if (this.#metaEntry) {
      this.#metaExports ??= import(this.#metaEntry.url).then(valueOf)
      Reflect.set(objectValue(context[ssrImportMetaKey]), this.#metaEntry.key, await this.#metaExports)
    }
    Reflect.set(module, 'exports', this.#facades.view(module.id, context[ssrModuleExportsKey]))
    return valueOf(await this.#inner.runInlinedModule(context, code))
  }

  async runExternalModule(file: string): Promise<Value> {
    return valueOf(await this.#inner.runExternalModule(file))
  }
}
