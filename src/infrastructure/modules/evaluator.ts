import { Injectable, inject } from '@zeltjs/core'
import type { EvaluatedModuleNode, ModuleEvaluator, ModuleRunnerContext } from '@hanamaru/vite/module-runner'
import { ESModulesEvaluator, ssrModuleExportsKey } from '@hanamaru/vite/module-runner'
import type { Value } from '../../foundation/value.js'
import { valueOf } from '../../foundation/value.js'
import { ModuleFacades } from './facades.js'

/**
 * Viteの評価器に被せて、評価中のmoduleのexportをnamespaceへ差し替える。
 * 継承ではなく内側に持つことで、公開するのはViteが求める評価の口だけになる。
 */
@Injectable()
export class FacadeEvaluator implements ModuleEvaluator {
  readonly #inner = new ESModulesEvaluator()
  readonly #facades: ModuleFacades

  constructor(facades = inject(ModuleFacades)) {
    this.#facades = facades
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
    Reflect.set(module, 'exports', this.#facades.view(module.id, context[ssrModuleExportsKey]))
    return valueOf(await this.#inner.runInlinedModule(context, code))
  }

  async runExternalModule(file: string): Promise<Value> {
    return valueOf(await this.#inner.runExternalModule(file))
  }
}
