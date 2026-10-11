import { Feature, type ServiceResolver } from '@zeltjs/core'
import { CollectionWorker } from './collection-worker.js'

interface CollectionCapabilities {
  readonly run: CollectionWorker['run']
  readonly fail: CollectionWorker['fail']
}

/** 収集workerの入口と、起動後の失敗通知をruntimeへ公開する。 */
export class CollectionFeature extends Feature<'collection', CollectionCapabilities> {
  readonly key = 'collection' as const

  featureClasses(): readonly [typeof CollectionWorker] {
    return [CollectionWorker]
  }

  blueprint(): Record<never, never> {
    return {}
  }

  async realize(resolver: ServiceResolver): Promise<CollectionCapabilities> {
    const worker = await resolver.get(CollectionWorker)
    return { run: worker.run.bind(worker), fail: worker.fail.bind(worker) }
  }
}
