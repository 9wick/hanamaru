import { Injectable } from '@zeltjs/core'
import type { MessagePort } from 'node:worker_threads'
import * as v from 'valibot'
import type { CliMessage } from '../../application/collection/events.js'
import { property } from '../../application/collection/javascript.js'
import { executionClosedSchema } from './schemas.js'

/** 収集workerと親を繋ぐMessagePort。protocolの送受信に触るのはここだけにする。 */
@Injectable()
export class CollectionChannel {
  #connection: MessagePort | undefined
  #closingExecution: Promise<void> | undefined

  connect(port: MessagePort): void {
    if (this.#connection) throw new Error('collection channel is already connected')
    this.#connection = port
  }

  get #port(): MessagePort {
    if (!this.#connection) throw new Error('collection channel is not connected')
    return this.#connection
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

  /** 実行workerの寿命はCLIが持つ。停止完了を待ってから変換器を閉じられるようにする。 */
  closeExecution(): Promise<void> {
    this.#closingExecution ??= new Promise<void>((resolve, reject) => {
      const disconnected = () => {
        this.#port.off('message', receive)
        reject(new Error('CLI disconnected before execution worker stopped'))
      }
      const receive = (input: unknown) => {
        if (property(input, 'type') !== 'execution-closed') return
        this.#port.off('message', receive)
        this.#port.off('close', disconnected)
        const parsed = v.safeParse(executionClosedSchema, input)
        if (parsed.success) resolve()
        else reject(new Error(`invalid execution shutdown message: ${v.summarize(parsed.issues)}`))
      }
      this.#port.on('message', receive)
      this.#port.once('close', disconnected)
      this.#port.postMessage({ type: 'close-execution' })
    })
    return this.#closingExecution
  }
}
