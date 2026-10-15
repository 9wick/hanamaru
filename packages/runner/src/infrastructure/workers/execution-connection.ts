import { Config } from '@zeltjs/core'
import type { MessagePort } from 'node:worker_threads'

/** 起動構成が選ぶworkerへの接続と、その寿命。 */
@Config({ abstract: true })
export abstract class ExecutionConnection {
  abstract readonly port: MessagePort
  abstract close(): Promise<void>
}
