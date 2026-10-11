import { Injectable, inject } from '@zeltjs/core'
import type { RuntimeBlueprint, RuntimeDefinitionHandle } from '@hanamaru/blueprint/model'
import { ProjectFiles, Warnings } from '../ports/collection-host.js'
import type { RootReference } from '@hanamaru/execution/application/ports/root-reference'
import { collectWithin } from '@hanamaru/execution/application/collection/current-scope'
import { DefinitionCollector } from '@hanamaru/execution/application/collection/definitions'
import { CollectionModules } from './module-session.js'
import { CollectionReporter } from './reporting.js'
import { CollectionLog } from '@hanamaru/execution/application/collection/scope'
import type { SelectedFile } from './select-files.js'
import type { TestSource } from './sources.js'

export interface CollectedDefinitions {
  blueprints: RuntimeBlueprint[]
  roots: RootReference[]
  sources: TestSource[]
}

function projectsOf(projects: string[]): string {
  return projects.length ? ` (projects: ${projects.join(', ')})` : ''
}

/** ファイルを読み、登録と出典を収集し、未登録・重複を検査する。 */
@Injectable()
export class FileDefinitionCollector {
  readonly #modules: CollectionModules
  readonly #definitions: DefinitionCollector
  readonly #files: ProjectFiles
  readonly #warnings: Warnings
  readonly #reporter: CollectionReporter

  #activeFile: SelectedFile | null = null

  constructor(
    modules = inject(CollectionModules),
    definitions = inject(DefinitionCollector),
    files = inject(ProjectFiles),
    warnings = inject(Warnings),
    reporter = inject(CollectionReporter),
  ) {
    this.#modules = modules
    this.#definitions = definitions
    this.#files = files
    this.#warnings = warnings
    this.#reporter = reporter
  }

  get failureContext(): string {
    const active = this.#activeFile
    return active ? `while collecting ${this.#files.relative(active.file)}${projectsOf(active.projects)}: ` : ''
  }

  /** 読み込みはCollectionLogを開いた間だけ記録される。読み込み順が登録順で、実行側もその順に突き合わせる。 */
  async collect(files: SelectedFile[], timeout: number): Promise<CollectedDefinitions> {
    const log = new CollectionLog()
    const definitions: RuntimeDefinitionHandle[] = [],
      roots: RootReference[] = [],
      sources: TestSource[] = [],
      collected = new Set<object>()
    await collectWithin(log, async () => {
      for (const { file, projects } of files) {
        this.#activeFile = { file, projects }
        this.#reporter.loading(file, timeout)
        await this.#modules.import(file)
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
    this.#activeFile = null
    for (const origin of log.unregisteredDefinitions(new Set(files.map(({ file }) => file))))
      this.#warnings.warn(
        `hanamaru: unregistered test definition: ${this.#files.relative(origin.file)}:${origin.line}:${origin.column}\n`,
      )
    return { blueprints: this.#definitions.collect(definitions), roots, sources }
  }
}
