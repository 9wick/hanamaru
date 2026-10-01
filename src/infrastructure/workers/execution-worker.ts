import { Injectable, inject } from '@zeltjs/core'
import { ExecutionChannel } from './execution-channel.js'
import { ExecutionLoader } from './execution-loader.js'
import { ExecutionServer } from './execution-server.js'
import { ExecutionSession } from './execution-session.js'
import type { ExecutionWorkerData } from './protocol.js'

/** 実行workerが受け持つ持ち場。読み込みが済むまでcommandを溜め、走らせられる形が揃ってからreadyを返す。 */
@Injectable()
export class ExecutionWorker {
  readonly #session: ExecutionSession
  readonly #loader: ExecutionLoader
  readonly #server: ExecutionServer
  readonly #channel: ExecutionChannel

  constructor(
    session = inject(ExecutionSession),
    loader = inject(ExecutionLoader),
    server = inject(ExecutionServer),
    channel = inject(ExecutionChannel),
  ) {
    this.#session = session
    this.#loader = loader
    this.#server = server
    this.#channel = channel
  }

  /** 親が口を閉じるまで戻らないため、待ち合わせずに走らせる。 */
  serve(workerData: ExecutionWorkerData): void {
    this.#channel.onMessage((message) => {
      if (!this.#session.receive(message)) this.#channel.fail(new Error('unexpected module compilation reply'))
    })
    this.#loader
      .load(workerData)
      .then((nodes) => {
        this.#channel.ready()
        this.#server.serve(nodes).catch((error: unknown) => this.#channel.fail(error))
      })
      .catch((error: unknown) => this.#channel.fail(error))
  }
}
