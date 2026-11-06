import type { ResolvedResult, SSRImportMetadata } from '@hanamaru/vite/module-runner'
import { ModuleRunner } from '@hanamaru/vite/module-runner'
import * as v from 'valibot'
import type { ModuleInvoke } from '../../application/ports/module-loader.js'
import { functionValue, invoke as invokeFunction, objectValue, property } from '../../foundation/value.js'
import type { TestModuleEvaluator } from './evaluator.js'
import type { Value } from '../../foundation/value.js'
type Namespace = Record<string, Value>

/**
 * Viteのmodule runnerを内側に持ち、importとtransportの契約を提供する。
 * 名前付きexportの存在検査に必要な内部への接続は、このadapterの中に閉じる。
 */
export class EvaluatedModuleRunner {
  readonly #inner: ModuleRunner
  #closing: Promise<void> | undefined

  constructor(evaluator: TestModuleEvaluator, transport: ModuleInvoke) {
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
            return { result: await transport(data.name, data.data) }
          },
        },
      },
      evaluator,
    )
    this.#inner = inner
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
