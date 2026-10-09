import { Injectable, inject } from '@zeltjs/core'
import { collectWithin } from '../../application/collection/current-scope.js'
import { CollectionLog } from '../../application/collection/scope.js'
import { indexExecutionNodes } from '../../application/execution/plan.js'
import { ExecutionPlanner } from '../../application/planning/planner.js'
import type { RuntimeDefinitionHandle } from '../../domain/definition/runtime.js'
import { validatedBlueprints } from '../../domain/definition/validation.js'
import type { ExecutionNode } from '../../domain/execution/model.js'
import { ModuleRegistry } from '../modules/reference.js'
import type { RunningRuntime } from '../modules/runtime.js'
import { ExecutionChannel } from './execution-channel.js'
import type { ExecutionWorkerData } from './protocol.js'

/**
 * 実行workerが自分の持ち場を用意する手順。収集と同じファイルを読み直して計画を組み直し、
 * 収集時の指紋と一致することを確かめる。食い違えば、どのpathが何を指すかの前提が崩れている。
 */
@Injectable()
export class ExecutionLoader {
  readonly #registry: ModuleRegistry
  readonly #channel: ExecutionChannel
  readonly #planner: ExecutionPlanner

  constructor(
    registry = inject(ModuleRegistry),
    channel = inject(ExecutionChannel),
    planner = inject(ExecutionPlanner),
  ) {
    this.#registry = registry
    this.#channel = channel
    this.#planner = planner
  }

  async load(runtime: RunningRuntime, workerData: ExecutionWorkerData): Promise<Map<string, ExecutionNode>> {
    const definitions = await this.#reimport(runtime, workerData)
    const plan = this.#planner.create(validatedBlueprints(definitions))
    if (JSON.stringify(this.#registry.describe(plan.allNodes)) !== workerData.shape)
      throw new TypeError('test definitions changed between collection and execution')
    return indexExecutionNodes(plan.allNodes)
  }

  /** 読み込みはCollectionLogを開いた間だけ記録される。収集時と同じ並び順でなければ突き合わせられない。 */
  async #reimport(runtime: RunningRuntime, workerData: ExecutionWorkerData): Promise<RuntimeDefinitionHandle[]> {
    const log = new CollectionLog()
    const definitions: RuntimeDefinitionHandle[] = []
    await collectWithin(log, async () => {
      const files = new Set<string>()
      for (const root of workerData.roots) {
        if (!files.has(root.file)) {
          this.#channel.loading(root.file)
          await runtime.import(root.file)
          files.add(root.file)
        }
        const registered = log.registrationsIn(root.file)[root.index]
        if (!registered) throw new TypeError('test registrations changed between collection and execution')
        if (JSON.stringify(registered.origin) !== JSON.stringify(root.origin))
          throw new TypeError('test registrations changed between collection and execution')
        definitions.push(registered.definition)
      }
      for (const file of files)
        if (log.registrationsIn(file).length !== workerData.roots.filter((root) => root.file === file).length)
          throw new TypeError('test registrations changed between collection and execution')
    })
    return definitions
  }
}
