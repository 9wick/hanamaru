import { Injectable, inject } from '@zeltjs/core'
import { CollectionSession } from '../../application/collection/session.js'
import type { CollectionRequest } from '../../application/ports/collection-runner.js'
import { CollectionChannel } from './collection-channel.js'

/** 収集workerが受け持つ1回ぶんの流れ。親からの中断はこのrunだけに効く。 */
@Injectable()
export class CollectionWorker {
  readonly #channel: CollectionChannel
  readonly #session: CollectionSession

  constructor(channel = inject(CollectionChannel), session = inject(CollectionSession)) {
    this.#channel = channel
    this.#session = session
  }

  run(request: CollectionRequest): Promise<void> {
    const controller = new AbortController()
    this.#channel.onInterrupt(() => controller.abort())
    return this.#session.run(request, controller.signal)
  }
}
