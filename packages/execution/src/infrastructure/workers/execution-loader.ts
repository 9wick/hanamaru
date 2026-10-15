import { Injectable, inject } from '@zeltjs/core'
import { observeDeclarations } from '@hanamaru/blueprint/declarations'
import { indexExecutionNodes } from '../../application/execution/plan.js'
import { ExecutionStructure } from '../../application/planning/structure.js'
import type { RuntimeDefinitionHandle } from '@hanamaru/blueprint/model'
import { validatedBlueprints } from '@hanamaru/blueprint/model'
import type { ExecutionNode } from '../../domain/execution/model.js'
import { ExecutionModules } from '../execution/modules.js'
import type { RunningRuntime } from '@hanamaru/module-runtime/infrastructure/modules/runtime'
import { ExecutionChannel } from './execution-channel.js'
import type { ExecutionWorkerData } from '@hanamaru/execution-protocol/data'

/**
 * 実行workerが自分の持ち場を用意する手順。収集と同じファイルを読み直して計画を組み直し、
 * 収集時の指紋と一致することを確かめる。食い違えば、どのpathが何を指すかの前提が崩れている。
 */
@Injectable()
export class ExecutionLoader {
  readonly #modules: ExecutionModules
  readonly #channel: ExecutionChannel
  readonly #planner: ExecutionStructure

  constructor(
    modules = inject(ExecutionModules),
    channel = inject(ExecutionChannel),
    planner = inject(ExecutionStructure),
  ) {
    this.#modules = modules
    this.#channel = channel
    this.#planner = planner
  }

  async load(runtime: RunningRuntime, workerData: ExecutionWorkerData): Promise<Map<string, ExecutionNode>> {
    const definitions = await this.#reimport(runtime, workerData)
    const nodes = this.#planner.build(validatedBlueprints(definitions))
    if (JSON.stringify(this.#modules.describe(nodes)) !== workerData.shape)
      throw new TypeError('test definitions changed between collection and execution')
    return indexExecutionNodes(nodes)
  }

  /** 読み込みはCollectionLogを開いた間だけ記録される。収集時と同じ並び順でなければ突き合わせられない。 */
  async #reimport(runtime: RunningRuntime, workerData: ExecutionWorkerData): Promise<RuntimeDefinitionHandle[]> {
    const registeredByFile = new Map<
      string,
      { definition: RuntimeDefinitionHandle; origin: { file: string; line: number; column: number } }[]
    >()
    const definitions: RuntimeDefinitionHandle[] = []
    await observeDeclarations(
      (event) => {
        if (event.kind !== 'registered') return
        const entries = registeredByFile.get(event.origin.file) ?? []
        entries.push(event)
        registeredByFile.set(event.origin.file, entries)
      },
      async () => {
        const files = new Set<string>()
        for (const root of workerData.roots) {
          if (!files.has(root.file)) {
            this.#channel.loading(root.file)
            await runtime.import(root.file)
            files.add(root.file)
          }
          const registered = (registeredByFile.get(root.file) ?? [])[root.index]
          if (!registered) throw new TypeError('test registrations changed between collection and execution')
          if (JSON.stringify(registered.origin) !== JSON.stringify(root.origin))
            throw new TypeError('test registrations changed between collection and execution')
          definitions.push(registered.definition)
        }
        for (const file of files)
          if (
            (registeredByFile.get(file) ?? []).length !== workerData.roots.filter((root) => root.file === file).length
          )
            throw new TypeError('test registrations changed between collection and execution')
      },
    )
    return definitions
  }
}
