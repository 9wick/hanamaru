import type { MessagePort } from 'node:worker_threads'
import type { CliMessage } from '../../application/collection/events.js'
import { property } from '../../foundation/value.js'

/** 収集workerと親を繋ぐMessagePort。protocolの送受信に触るのはここだけにする。 */
export class CollectionChannel {
  readonly #port: MessagePort

  constructor(port: MessagePort) {
    this.#port = port
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
