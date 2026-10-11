import { Config } from '@zeltjs/core'
import type { MessagePort } from 'node:worker_threads'

/** 実行workerが起動時に受け取る環境。 */
@Config({ abstract: true })
export abstract class ExecutionEnvironment {
  abstract readonly port: MessagePort
}
