import { Injectable, inject } from '@zeltjs/core'
import { ModuleTransport } from '../../application/ports/module-loader.js'
import { ModuleRuntimeLauncher } from '../modules/runtime.js'
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
  readonly #runtimes: ModuleRuntimeLauncher
  readonly #transport: ModuleTransport

  constructor(
    session = inject(ExecutionSession),
    loader = inject(ExecutionLoader),
    server = inject(ExecutionServer),
    channel = inject(ExecutionChannel),
    runtimes = inject(ModuleRuntimeLauncher),
    transport = inject(ModuleTransport),
  ) {
    this.#session = session
    this.#loader = loader
    this.#server = server
    this.#channel = channel
    this.#runtimes = runtimes
    this.#transport = transport
  }

  /** 親が口を閉じるまで戻らないため、待ち合わせずに走らせる。 */
  serve(workerData: ExecutionWorkerData): void {
    this.#channel.onMessage((message) => {
      if (!this.#session.receive(message)) this.#channel.fail(new Error('unexpected module compilation reply'))
    })
    // 変換は親のportへ頼む。差し替える宛先は収集が決めたもので、読み込む前に台ごと組み立てる。
    const runtime = this.#runtimes.start(this.#transport, workerData.preparation)
    this.#loader
      .load(runtime, workerData)
      .then((nodes) => {
        this.#channel.ready()
        this.#server.serve(nodes, runtime).catch((error: unknown) => this.#channel.fail(error))
      })
      .catch((error: unknown) => this.#channel.fail(error))
  }
}
