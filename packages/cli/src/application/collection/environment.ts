import { Injectable, inject } from '@zeltjs/core'
import { ExecutionLauncher, type PreparedExecution } from '@hanamaru/execution/application/ports/executor'
import type { Config } from './config.js'
import { CollectionModules } from './module-session.js'
import { CollectionReporter } from './reporting.js'

/** テスト実行の環境を準備し、実行workerを止めてから変換runtimeを閉じる。 */
@Injectable()
export class TestRunEnvironment {
  readonly #execution: ExecutionLauncher
  readonly #modules: CollectionModules
  readonly #reporter: CollectionReporter
  #prepared: PreparedExecution | undefined

  constructor(
    execution = inject(ExecutionLauncher),
    modules = inject(CollectionModules),
    reporter = inject(CollectionReporter),
  ) {
    this.#execution = execution
    this.#modules = modules
    this.#reporter = reporter
  }

  async open(vite: Config['vite'], timeout: number): Promise<void> {
    if (this.#prepared) throw new Error('test run environment is already open')
    this.#prepared = this.#execution.open()
    this.#reporter.loading('test runtime setup', timeout)
    await this.#modules.open(vite)
  }

  async close(): Promise<void> {
    const prepared = this.#prepared
    this.#prepared = undefined
    try {
      await prepared?.close()
    } finally {
      await this.#modules.close()
    }
  }
}
