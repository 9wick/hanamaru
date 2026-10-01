import { pathToFileURL } from 'node:url'
import { collectWithin } from '../../application/collection/current-scope.js'
import { CollectionLog } from '../../application/collection/scope.js'
import { indexExecutionNodes, createPlan } from '../../application/execution/plan.js'
import type { RuntimeDefinitionHandle } from '../../domain/definition/runtime.js'
import { validatedBlueprints } from '../../domain/definition/validation.js'
import type { ExecutionNode } from '../../domain/execution/model.js'
import type { ModuleRegistry } from '../modules/reference.js'
import type { ModuleRuntime } from '../modules/runtime.js'
import type { ExecutionChannel } from './execution-channel.js'
import { describeExecutionPlan } from './plan-shape.js'
import type { ExecutionWorkerData } from './protocol.js'

/**
 * 実行workerが自分の持ち場を用意する手順。収集と同じファイルを読み直して計画を組み直し、
 * 収集時の指紋と一致することを確かめる。食い違えば、どのpathが何を指すかの前提が崩れている。
 */
export class ExecutionLoader {
  readonly #runtime: ModuleRuntime
  readonly #registry: ModuleRegistry
  readonly #channel: ExecutionChannel

  constructor(runtime: ModuleRuntime, registry: ModuleRegistry, channel: ExecutionChannel) {
    this.#runtime = runtime
    this.#registry = registry
    this.#channel = channel
  }

  async load(workerData: ExecutionWorkerData): Promise<Map<string, ExecutionNode>> {
    const definitions = await this.#reimport(workerData)
    const plan = createPlan(validatedBlueprints(definitions))
    if (JSON.stringify(describeExecutionPlan(this.#registry, plan.allNodes)) !== workerData.shape)
      throw new TypeError('test definitions changed between collection and execution')
    return indexExecutionNodes(plan.allNodes)
  }

  /** 読み込みはCollectionLogを開いた間だけ記録される。収集時と同じ並び順でなければ突き合わせられない。 */
  async #reimport(workerData: ExecutionWorkerData): Promise<RuntimeDefinitionHandle[]> {
    const log = new CollectionLog()
    const definitions: RuntimeDefinitionHandle[] = []
    await collectWithin(log, async () => {
      const files = new Set<string>()
      for (const root of workerData.roots) {
        if (!files.has(root.file)) {
          this.#channel.loading(root.file)
          await this.#runtime.import(pathToFileURL(root.file).href)
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
