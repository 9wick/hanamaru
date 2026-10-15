import type { TargetCatalogue } from '@hanamaru/runner/domain/execution/targets'
import { ProjectFilesystem } from '../filesystem/project-files.js'
import { Injectable, inject } from '@zeltjs/core'
import type { MutableRunResult } from '@hanamaru/runner/domain/result/mutable'
import type { CollectionRequest } from '../../application/ports/collection-runner.js'
import { FileDefinitionCollector } from './file-definitions.js'
import { TestFileSelection } from './file-selection.js'
import { TestRunEnvironment } from './environment.js'
import { CollectionReporter } from './reporting.js'
import type { Reporter } from '../../application/collection/events.js'
import { RunContext } from '@hanamaru/runner/application/execution/context'
import { runExclusively } from '@hanamaru/runner/application/execution/current-run'
import type { RunSettings } from '@hanamaru/runner/application/execution/options'
import { RunTests } from '@hanamaru/runner/infrastructure/execution/run-tests'

export type FileRunResult =
  | { kind: 'execution'; result: MutableRunResult; reporter: Reporter }
  | { kind: 'catalogue'; catalogue: TargetCatalogue; reporter: Reporter }

/** ファイルから定義を収集し、計画を作り、実行と後処理を終えて出典付きの結果を返す。 */
@Injectable()
export class RunTestFiles {
  readonly #selection: TestFileSelection
  readonly #definitions: FileDefinitionCollector
  readonly #execution: RunTests
  readonly #environment: TestRunEnvironment
  readonly #reporter: CollectionReporter
  readonly #files: ProjectFilesystem
  readonly #context: RunContext

  constructor(
    selection = inject(TestFileSelection),
    definitions = inject(FileDefinitionCollector),
    execution = inject(RunTests),
    environment = inject(TestRunEnvironment),
    reporter = inject(CollectionReporter),
    files = inject(ProjectFilesystem),
    context = inject(RunContext),
  ) {
    this.#selection = selection
    this.#definitions = definitions
    this.#execution = execution
    this.#environment = environment
    this.#reporter = reporter
    this.#files = files
    this.#context = context
  }

  execute(request: CollectionRequest, signal: AbortSignal): Promise<FileRunResult> {
    return this.#context.run(() => this.#execute(request, signal))
  }

  async #execute(request: CollectionRequest, signal: AbortSignal): Promise<FileRunResult> {
    const { config, limits, files } = await this.#selection.select(request)
    try {
      await this.#environment.open(config.vite, limits.timeout)
      const { blueprints, roots, sources } = await this.#definitions.collect(files, limits.timeout)
      if (request.options.list)
        return { kind: 'catalogue', catalogue: this.#execution.catalogue(blueprints, roots), reporter: limits.reporter }
      const target = request.options.id
        ? { kind: 'id' as const, id: request.options.id }
        : request.options.location
          ? {
              kind: 'location' as const,
              file: this.#files.resolve(request.options.location.file),
              line: request.options.location.line,
            }
          : undefined
      const settings: RunSettings = {
        target,
        forbidOnly: request.options.ci,
        failOnFlaky: request.options.failOnFlaky,
        filter: request.options.filter,
      }
      this.#reporter.presentation(limits.reporter, limits.shutdownGrace)
      const result = await runExclusively(() =>
        this.#execution.executeBlueprints(blueprints, settings, signal, { roots, sources, timeout: limits.timeout }),
      )
      return { kind: 'execution', result, reporter: limits.reporter }
    } finally {
      await this.#environment.close()
    }
  }
}
