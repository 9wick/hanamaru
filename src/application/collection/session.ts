import { Injectable, inject } from '@zeltjs/core'
import type { RuntimeBlueprint, RuntimeDefinitionHandle } from '../../domain/definition/runtime.js'
import { validatedBlueprints } from '../../domain/definition/validation.js'
import { positive } from '../../domain/execution/config.js'
import type { Plan } from '../../domain/execution/model.js'
import { errorStack } from '../../foundation/errors.js'
import type { RunSettings } from '../execution/options.js'
import { runExclusively } from '../execution/current-run.js'
import { createPlan } from '../execution/plan.js'
import type { ModuleSession } from '../ports/collection-host.js'
import { ModuleToolchain, ProjectFiles, Warnings } from '../ports/collection-host.js'
import type { CollectionRequest } from '../ports/collection-runner.js'
import type { ExecutionSpec, PreparedExecution } from '../ports/executor.js'
import { ExecutionLauncher } from '../ports/executor.js'
import type { RootReference } from '../ports/module-loader.js'
import type { Config } from './config.js'
import { collectWithin } from './current-scope.js'
import type { Reporter } from './events.js'
import { CollectionReporter } from './reporting.js'
import type { CliOptions } from './options.js'
import type { TestSource } from './sources.js'
import { nodeSources, withSources } from './sources.js'
import { CollectionLog } from './scope.js'
import type { SelectedFile } from './select-files.js'
import { selectFiles } from './select-files.js'

/** 設定が決まってから分かる期限・猶予・表示の形。引数の指定が設定より優先する。 */
interface CollectionLimits {
  timeout: number
  shutdownGrace: number
  reporter: Reporter
}

function collectionLimits(options: CollectionRequest['options'], config: Config): CollectionLimits {
  const timeout = options.collectionTimeout ?? config.collectionTimeout ?? 30_000
  const shutdownGrace = options.shutdownGrace ?? config.shutdownGrace ?? 1_000
  positive(timeout, 'collectionTimeout')
  positive(shutdownGrace, 'shutdownGrace')
  const reporter = options.reporter ?? config.reporter ?? 'pretty'
  if (reporter !== 'pretty' && reporter !== 'json') throw new TypeError('reporter must be pretty or json')
  return { timeout, shutdownGrace, reporter }
}

/** 同じファイルが複数のprojectから選ばれることがあるため、ファイル名だけでは失敗の場所が決まらない。 */
function projectsOf(projects: string[]): string {
  return projects.length ? ` (projects: ${projects.join(', ')})` : ''
}

/** 読み込んだ定義と、その出どころ。計画と結果の出典づけが同じ並び順を見る。 */
interface Collected {
  definitions: RuntimeDefinitionHandle[]
  roots: RootReference[]
  sources: TestSource[]
}

/** 組み立てた計画と、実行に渡す形。出どころは計画の並びに合わせて引き直した姿で持つ。 */
interface Planned {
  plan: Plan
  settings: RunSettings
  spec: ExecutionSpec
  sources: readonly TestSource[]
}

/**
 * 1回の収集と実行を進める。test runtimeの資源は選んだファイルが決まってから開き、
 * 開いたあとはこの手順が畳むところまで持つ。
 */
@Injectable()
export class CollectionSession {
  readonly #files: ProjectFiles
  readonly #modules: ModuleToolchain
  readonly #warnings: Warnings
  readonly #reporter: CollectionReporter
  readonly #executor: ExecutionLauncher

  constructor(
    files = inject(ProjectFiles),
    modules = inject(ModuleToolchain),
    warnings = inject(Warnings),
    reporter = inject(CollectionReporter),
    executor = inject(ExecutionLauncher),
  ) {
    this.#files = files
    this.#modules = modules
    this.#warnings = warnings
    this.#reporter = reporter
    this.#executor = executor
  }

  async run(request: CollectionRequest, signal: AbortSignal): Promise<void> {
    // どのファイルを読んでいる途中で落ちたかは、失敗の文脈として外側のcatchから見えなければならない。
    const collecting: { file: SelectedFile | null } = { file: null }
    try {
      // 設定はcompilerより先に要る。vite設定を知らないままtest runtimeを立てられない。
      const config = await this.#loadConfig(request.options)
      const limits = collectionLimits(request.options, config)
      const files = this.#select(request, config)
      const execution = this.#executor.open()
      let modules: ModuleSession | undefined
      try {
        this.#reporter.loading('test runtime setup', limits.timeout)
        modules = await this.#modules.open(config.vite)
        const collected = await this.#collect(modules, files, limits.timeout, collecting)
        await this.#execute(execution, modules, this.#plan(modules, collected, request), limits, signal)
      } finally {
        // 変換要求が届かなくなってからcompilerを閉じる。compiler起動の失敗時もworkerは残さない。
        try {
          await execution.close()
        } finally {
          await modules?.close()
        }
      }
    } catch (error) {
      const context = collecting.file
        ? `while collecting ${this.#files.relative(collecting.file.file)}${projectsOf(collecting.file.projects)}: `
        : ''
      this.#reporter.error(context + errorStack(error))
    }
  }

  /**
   * 設定ファイルの読み込み自体にも期限がある。設定はまだ読めていないため、引数の指定か既定値だけで測る。
   * 設定が決まってからの期限はcollectionLimitsが測り直す。
   */
  #loadConfig(options: CliOptions): Promise<Config> {
    const timeout = options.collectionTimeout ?? 30_000
    positive(timeout, 'collectionTimeout')
    return this.#files.readConfig(options, (file) => this.#reporter.loading(file, timeout))
  }

  #select(request: CollectionRequest, config: Config): SelectedFile[] {
    const files = selectFiles(config, request, this.#files)
    if (!files.length) throw new TypeError('no test files matched')
    return files
  }

  /** 読み込みはCollectionLogを開いた間だけ記録される。読み込み順が登録順で、実行側もその順に突き合わせる。 */
  async #collect(
    modules: ModuleSession,
    files: SelectedFile[],
    timeout: number,
    collecting: { file: SelectedFile | null },
  ): Promise<Collected> {
    const log = new CollectionLog()
    const definitions: RuntimeDefinitionHandle[] = [],
      roots: RootReference[] = [],
      sources: TestSource[] = [],
      collected = new Set<object>()
    await collectWithin(log, async () => {
      for (const { file, projects } of files) {
        collecting.file = { file, projects }
        this.#reporter.loading(file, timeout)
        await modules.import(file)
        const registered = log.registrationsIn(file)
        if (!registered.length)
          throw new TypeError(`no tests registered in ${this.#files.relative(file)}${projectsOf(projects)}`)
        for (const [index, entry] of registered.entries()) {
          const definition = entry.definition
          if (collected.has(definition))
            throw new TypeError(
              `duplicate root definition: ${this.#files.relative(file)}:${entry.origin.line}${projectsOf(projects)}`,
            )
          collected.add(definition)
          definitions.push(definition)
          roots.push({ file, index, origin: entry.origin })
          sources.push({ file: this.#files.relative(file), projects })
        }
      }
    })
    collecting.file = null
    for (const origin of log.unregisteredDefinitions(new Set(files.map(({ file }) => file))))
      this.#warnings.warn(
        `hanamaru: unregistered test definition: ${this.#files.relative(origin.file)}:${origin.line}:${origin.column}\n`,
      )
    return { definitions, roots, sources }
  }

  #plan(modules: ModuleSession, { definitions, roots, sources }: Collected, request: CollectionRequest): Planned {
    const settings: RunSettings = {
      forbidOnly: request.options.ci,
      failOnFlaky: request.options.failOnFlaky,
      filter: request.options.filter,
    }
    const blueprints: RuntimeBlueprint[] = validatedBlueprints(definitions)
    const plan = createPlan(blueprints, settings)
    return {
      plan,
      settings,
      sources: nodeSources(plan.allNodes, sources),
      spec: {
        roots,
        preparation: modules.prepare(blueprints),
        shape: JSON.stringify(modules.describe(plan.allNodes)),
      },
    }
  }

  async #execute(
    prepared: PreparedExecution,
    modules: ModuleSession,
    { plan, settings, spec, sources }: Planned,
    limits: CollectionLimits,
    signal: AbortSignal,
  ) {
    // 1回のrunの通知は収集のprotocolへ出す。出どころを付けられるのは計画が組み上がったこの時点から。
    this.#reporter.sources(sources)
    const execution = await prepared.start(spec, {
      invoke: (name, args) => modules.invoke(name, args),
      signal,
      onLoading: (file) => this.#reporter.loading(file, limits.timeout),
    })
    this.#reporter.running(limits.reporter, limits.shutdownGrace)
    let result
    try {
      // 重なりの錠は走査より先に取る。読み込んだテストファイルから始まったrunも重なりとして弾く。
      result = await runExclusively(() => execution.run(() => plan, settings, signal))
    } finally {
      await execution.close()
    }
    this.#reporter.result(withSources(result, sources), limits.reporter)
  }
}
