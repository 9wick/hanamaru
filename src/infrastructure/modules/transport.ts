import { Config, inject } from '@zeltjs/core'
import { ModuleTransport } from '../../application/ports/module-loader.js'
import type { Value } from '../../foundation/value.js'
import { ModuleCompiler } from './compiler.js'

/** 自分で立てたcompilerへ繋ぐ取り寄せ口。収集workerはこちらを選ぶ。 */
@Config()
export class CompilerTransport extends ModuleTransport {
  readonly #compiler: ModuleCompiler

  constructor(compiler = inject(ModuleCompiler)) {
    super()
    this.#compiler = compiler
  }

  invoke(name: string, args: Value[]): Promise<Value> {
    return this.#compiler.invoke(name, args)
  }
}
