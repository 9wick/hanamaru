import { Injectable, inject } from '@zeltjs/core'
import { type PreparedExecution } from '@hanamaru/runner/application/ports/executor'
import { WorkerExecutionLauncher } from '@hanamaru/runner/infrastructure/workers/client'
import type { Config } from '../../application/collection/config.js'
import { CollectionModules } from '@hanamaru/runner/infrastructure/modules/collection-modules'
import { CollectionReporter } from './reporting.js'

/** テスト実行の環境を準備し、実行workerを止めてから変換runtimeを閉じる。 */
@Injectable()
export class TestRunEnvironment {
  readonly #execution: WorkerExecutionLauncher
  readonly #modules: CollectionModules
  readonly #reporter: CollectionReporter
  #prepared: PreparedExecution | undefined

  constructor(
    execution = inject(WorkerExecutionLauncher),
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
