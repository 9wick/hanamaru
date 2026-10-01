import type { RuntimeBlueprint, RuntimeDefinitionHandle } from '../../domain/definition/runtime.js'
import { validatedBlueprints } from '../../domain/definition/validation.js'
import { positive } from '../../domain/execution/config.js'
import type { Plan } from '../../domain/execution/model.js'
import type { MutableRunResult } from '../../domain/result/mutable.js'
import { errorStack } from '../../foundation/errors.js'
import type { RunSettings } from '../execution/options.js'
import { createPlan } from '../execution/plan.js'
import { createRunWalker } from '../execution/runner.js'
import type { RunListeners } from '../execution/services.js'
import { createRunServices } from '../execution/services.js'
import type { CollectionHost, CollectionRuntime, ModuleCompiler } from '../ports/collection-host.js'
import type { CollectionRequest } from '../ports/collection-runner.js'
import type { ExecutionSpec } from '../ports/executor.js'
import type { ModuleInvoke, RootReference } from '../ports/module-loader.js'
import type { Config } from './config.js'
import { collectWithin } from './current-scope.js'
import type { CliMessage, Reporter } from './events.js'
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
  sources: { file: string; projects: string[] }[]
}

/** 組み立てた計画と、結果を外へ出すときの形。 */
interface Planned {
  plan: Plan
  settings: RunSettings
  spec: ExecutionSpec
  withSources: (result: MutableRunResult) => MutableRunResult
}

/**
 * 1回の収集と実行を進める。設定は読み込み済みのものを受け取り、
 * test runtimeの資源(compiler・module runtime)だけは選んだファイルが決まってから作って自分で閉じる。
 */
export class CollectionSession {
  readonly #host: CollectionHost
  readonly #send: (event: CliMessage) => void

  constructor(host: CollectionHost, send: (event: CliMessage) => void) {
    this.#host = host
    this.#send = send
  }

  async run(request: CollectionRequest, config: Config, signal: AbortSignal): Promise<void> {
    let compiler: ModuleCompiler | undefined
    let runtime: CollectionRuntime | undefined
    // どのファイルを読んでいる途中で落ちたかは、失敗の文脈として外側のcatchから見えなければならない。
    const collecting: { file: SelectedFile | null } = { file: null }
    try {
      const limits = collectionLimits(request.options, config)
      const files = this.#select(request, config)
      this.#send({ type: 'loading', file: 'test runtime setup', timeout: limits.timeout })
      compiler = await this.#host.modules.createCompiler(config.vite)
      runtime = this.#host.modules.createRuntime(compiler.invoke)
      const collected = await this.#collect(files, runtime, limits.timeout, collecting)
      await this.#execute(this.#plan(collected, request), limits, compiler.invoke, signal)
    } catch (error) {
      const context = collecting.file
        ? `while collecting ${this.#host.files.relative(collecting.file.file)}${projectsOf(collecting.file.projects)}: `
        : ''
      this.#send({ type: 'error', message: context + errorStack(error) })
    } finally {
      await runtime?.close()
      await compiler?.close()
    }
  }

  #select(request: CollectionRequest, config: Config): SelectedFile[] {
    const files = selectFiles(config, request, this.#host.files)
    if (!files.length) throw new TypeError('no test files matched')
    return files
  }

  /** 読み込みはCollectionLogを開いた間だけ記録される。読み込み順が登録順で、実行側もその順に突き合わせる。 */
  async #collect(
    files: SelectedFile[],
    runtime: CollectionRuntime,
    timeout: number,
    collecting: { file: SelectedFile | null },
  ): Promise<Collected> {
    const log = new CollectionLog()
    const definitions: RuntimeDefinitionHandle[] = [],
      roots: RootReference[] = [],
      sources: { file: string; projects: string[] }[] = [],
      collected = new Set<object>()
    await collectWithin(log, async () => {
      for (const { file, projects } of files) {
        collecting.file = { file, projects }
        this.#send({ type: 'loading', file, timeout })
        await runtime.import(file)
        const registered = log.registrationsIn(file)
        if (!registered.length)
          throw new TypeError(`no tests registered in ${this.#host.files.relative(file)}${projectsOf(projects)}`)
        for (const [index, entry] of registered.entries()) {
          const definition = entry.definition
          if (collected.has(definition))
            throw new TypeError(
              `duplicate root definition: ${this.#host.files.relative(file)}:${entry.origin.line}${projectsOf(projects)}`,
            )
          collected.add(definition)
          definitions.push(definition)
          roots.push({ file, index, origin: entry.origin })
          sources.push({ file: this.#host.files.relative(file), projects })
        }
      }
    })
    collecting.file = null
    for (const origin of log.unregisteredDefinitions(new Set(files.map(({ file }) => file))))
      this.#host.warn(
        `hanamaru: unregistered test definition: ${this.#host.files.relative(origin.file)}:${origin.line}:${origin.column}\n`,
      )
    return { definitions, roots, sources }
  }

  #plan({ definitions, roots, sources }: Collected, request: CollectionRequest): Planned {
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
      spec: {
        roots,
        preparation: this.#host.modules.prepare(blueprints),
        shape: JSON.stringify(this.#host.modules.describe(plan.allNodes)),
      },
      withSources: (result) => ({
        ...result,
        tests: result.tests.map((node) => ({
          ...node,
          source: sources[plan.allNodes[node.path[0]].rootIndex],
        })),
      }),
    }
  }

  /** 実行場所はrunのサービスを見ながら進むため、サービスを組み立ててから開く。 */
  async #execute(
    { plan, settings, spec, withSources }: Planned,
    limits: CollectionLimits,
    invoke: ModuleInvoke,
    signal: AbortSignal,
  ): Promise<void> {
    const listeners: RunListeners = {
      onProgress: (progress) =>
        this.#send({
          type: 'progress',
          progress: progress.kind === 'init' ? { ...progress, result: withSources(progress.result) } : progress,
        }),
      onTimeout: (result) => this.#send({ type: 'timeout', result: withSources(result) }),
      onDeadline: (deadline) =>
        this.#send({
          type: 'deadline',
          ...deadline,
        }),
    }
    const run = createRunServices(listeners)
    const execution = this.#host.openExecution(run, {
      invoke,
      signal,
      onLoading: (file) => this.#send({ type: 'loading', file, timeout: limits.timeout }),
    })
    await execution.start(spec)
    this.#send({ type: 'running', reporter: limits.reporter, shutdownGrace: limits.shutdownGrace })
    let result
    try {
      result = await createRunWalker(run, this.#host.comparison, execution).run(() => plan, settings, signal)
    } finally {
      await execution.close()
    }
    this.#send({ type: 'result', result: withSources(result), reporter: limits.reporter })
  }
}
