import { Injectable, inject } from '@zeltjs/core'
import type { MutableRunResult } from '../../domain/result/mutable.js'
import type { CollectionRequest } from '../ports/collection-runner.js'
import { ExecutionLauncher } from '../ports/executor.js'
import { FileDefinitionCollector } from '../collection/file-definitions.js'
import { TestFileSelection } from '../collection/file-selection.js'
import { TestRunEnvironment } from '../collection/environment.js'
import { CollectionReporter } from '../collection/reporting.js'
import type { Reporter } from '../collection/events.js'
import { nodeSources, withSources } from '../collection/sources.js'
import { RunContext } from '../execution/context.js'
import { runExclusively } from '../execution/current-run.js'
import type { RunSettings } from '../execution/options.js'
import { PlanExecutor } from '../execution/runner.js'
import { ExecutionPlanner } from '../planning/planner.js'

export interface FileRunResult {
  result: MutableRunResult
  reporter: Reporter
}

/** ファイルから定義を収集し、計画を作り、実行と後処理を終えて出典付きの結果を返す。 */
@Injectable()
export class RunTestFiles {
  readonly #selection: TestFileSelection
  readonly #definitions: FileDefinitionCollector
  readonly #planner: ExecutionPlanner
  readonly #execution: PlanExecutor
  readonly #environment: TestRunEnvironment
  readonly #backend: ExecutionLauncher
  readonly #reporter: CollectionReporter
  readonly #context: RunContext

  constructor(
    selection = inject(TestFileSelection),
    definitions = inject(FileDefinitionCollector),
    planner = inject(ExecutionPlanner),
    execution = inject(PlanExecutor),
    environment = inject(TestRunEnvironment),
    backend = inject(ExecutionLauncher),
    reporter = inject(CollectionReporter),
    context = inject(RunContext),
  ) {
    this.#selection = selection
    this.#definitions = definitions
    this.#planner = planner
    this.#execution = execution
    this.#environment = environment
    this.#backend = backend
    this.#reporter = reporter
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
      const settings: RunSettings = {
        forbidOnly: request.options.ci,
        failOnFlaky: request.options.failOnFlaky,
        filter: request.options.filter,
      }
      const plan = this.#planner.create(blueprints, settings)
      const nodeOrigins = nodeSources(plan.allNodes, sources)
      this.#reporter.sources(nodeOrigins)
      await this.#backend.initialize(plan, roots, signal, limits.timeout)
      this.#reporter.running(limits.reporter, limits.shutdownGrace)
      const result = await runExclusively(() => this.#execution.execute(plan, settings, signal))
      return { result: withSources(result, nodeOrigins), reporter: limits.reporter }
    } finally {
      await this.#environment.close()
    }
  }
}
