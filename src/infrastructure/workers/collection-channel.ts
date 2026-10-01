import { Config, inject } from '@zeltjs/core'
import type { MessagePort } from 'node:worker_threads'
import type { CliMessage } from '../../application/collection/events.js'
import { CollectionSink } from '../../application/collection/events.js'
import { property } from '../../foundation/value.js'
import { CollectionEnvironment } from './environment.js'

/** 収集workerと親を繋ぐMessagePort。protocolの送受信に触るのはここだけにする。 */
@Config()
export class CollectionChannel extends CollectionSink {
  readonly #port: MessagePort

  constructor(environment = inject(CollectionEnvironment)) {
    super()
    this.#port = environment.port
  }

  post(event: CliMessage): void {
    this.#port.postMessage(event)
  }

  /** 親から届く合図は中断だけ。他の形は収集中に意味を持たないため読み捨てる。 */
  onInterrupt(listener: () => void): void {
    this.#port.on('message', (message) => {
      if (property(message, 'type') === 'interrupt') listener()
    })
  }
}
