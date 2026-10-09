import { Injectable, inject } from '@zeltjs/core'
import { errorStack } from '../../foundation/errors.js'
import type { CollectionRequest } from '../ports/collection-runner.js'
import { RunTestFiles } from '../usecases/run-test-files.js'
import { FileDefinitionCollector } from './file-definitions.js'
import { CollectionReporter } from './reporting.js'

/** worker入口でUseCaseの結果と失敗をCLIの通知へ変換する。 */
@Injectable()
export class CollectionSession {
  readonly #tests: RunTestFiles
  readonly #definitions: FileDefinitionCollector
  readonly #reporter: CollectionReporter

  constructor(
    tests = inject(RunTestFiles),
    definitions = inject(FileDefinitionCollector),
    reporter = inject(CollectionReporter),
  ) {
    this.#tests = tests
    this.#definitions = definitions
    this.#reporter = reporter
  }

  async run(request: CollectionRequest, signal: AbortSignal): Promise<void> {
    try {
      const { result, reporter } = await this.#tests.execute(request, signal)
      this.#reporter.result(result, reporter)
    } catch (error) {
      this.#reporter.error(this.#definitions.failureContext + errorStack(error))
    }
  }
}
