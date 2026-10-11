import { Feature, type ServiceResolver } from '@zeltjs/core'
import { ExecutionWorker } from './execution-worker.js'

interface ExecutionCapabilities {
  readonly serve: ExecutionWorker['serve']
}

/** 実行workerのcommand受信を、起動時に構成したruntimeから開始する。 */
export class ExecutionFeature extends Feature<'execution', ExecutionCapabilities> {
  readonly key = 'execution' as const

  featureClasses(): readonly [typeof ExecutionWorker] {
    return [ExecutionWorker]
  }

  blueprint(): Record<never, never> {
    return {}
  }

  async realize(resolver: ServiceResolver): Promise<ExecutionCapabilities> {
    const worker = await resolver.get(ExecutionWorker)
    return { serve: worker.serve.bind(worker) }
  }
}
