import { Injectable, inject } from '@zeltjs/core'
import type { EvaluatedModuleNode, ResolvedResult, SSRImportMetadata } from '@hanamaru/vite/module-runner'
import { ModuleRunner } from '@hanamaru/vite/module-runner'
import * as v from 'valibot'
import { ModuleTransport } from '../../application/ports/module-loader.js'
import { functionValue, invoke as invokeFunction, objectValue, property, valueOf } from '../../foundation/value.js'
import { FacadeEvaluator } from './evaluator.js'
import type { Namespace } from './facades.js'
import { ModuleFacades } from './facades.js'

/**
 * Viteのmodule runnerを内側に持ち、読み込んだmoduleをnamespaceへ被せ替える。
 * Vite 8.3は読み込み結果を包む公開の口を持たないため、内部への接続はこのadapterの中だけに閉じる。
 */
@Injectable()
export class FacadeRunner {
  readonly #inner: ModuleRunner
  #closing: Promise<void> | undefined

  constructor(
    facades = inject(ModuleFacades),
    evaluator = inject(FacadeEvaluator),
    transport = inject(ModuleTransport),
  ) {
    const inner = new ModuleRunner(
      {
        hmr: false,
        transport: {
          async invoke(payload) {
            if (payload.type !== 'custom' || payload.event !== 'vite:invoke')
              throw new Error('unexpected module transport payload')
            const data = v.parse(
              v.object({ name: v.string(), data: v.array(v.union([v.string(), v.undefined(), v.looseObject({})])) }),
              payload.data,
            )
            return { result: await transport.invoke(data.name, data.data) }
          },
        },
      },
      evaluator,
    )
    this.#inner = inner
    const directRequest = functionValue(property(ModuleRunner.prototype, 'directRequest'))
    Reflect.defineProperty(inner, 'directRequest', {
      async value(url: string, module: EvaluatedModuleNode, callstack: string[]): Promise<Namespace> {
        const original = valueOf(await Promise.resolve(invokeFunction(directRequest, inner, [url, module, callstack])))
        const facade = facades.view(module.id, original)
        module.exports = facade
        return facade
      },
    })
    const processImport = functionValue(property(ModuleRunner.prototype, 'processImport'))
    Reflect.defineProperty(inner, 'processImport', {
      value(exports: Namespace, result: ResolvedResult, metadata?: SSRImportMetadata) {
        if (!metadata?.isDynamicImport)
          for (const name of metadata?.importedNames ?? []) {
            if (!(name in exports))
              throw new SyntaxError(`The requested module '${result.url}' does not provide an export named '${name}'`)
          }
        return objectValue(invokeFunction(processImport, inner, [exports, result, metadata]))
      },
    })
  }

  import(url: string): Promise<Namespace> {
    return this.#inner.import<Namespace>(url)
  }

  /** 二重に閉じても同じ約束を返す。 */
  close(): Promise<void> {
    this.#closing ??= this.#inner.close()
    return this.#closing
  }
}
