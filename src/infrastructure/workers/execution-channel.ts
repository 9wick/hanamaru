import type { MessagePort } from 'node:worker_threads'
import * as v from 'valibot'
import type { Stage } from '../../application/execution/state.js'
import type { ExecutionPhase } from '../../domain/result/types.js'
import { errorStack } from '../../foundation/errors.js'
import type { Value } from '../../foundation/value.js'
import type { ExecutionIncoming, ExecutionMessage, ReplyValue } from './protocol.js'
import { executionIncomingSchema } from './schemas.js'

/** 実行workerと親を繋ぐMessagePort。protocolの形を組み立てて送受信するのはここだけにする。 */
export class ExecutionChannel {
  readonly #port: MessagePort

  constructor(port: MessagePort) {
    this.#port = port
  }

  #post(message: ExecutionMessage): void {
    this.#port.postMessage(message)
  }

  compile(request: { id: number; name: string; args: Value[] }): void {
    this.#post({ type: 'compile', ...request })
  }
  ready(): void {
    this.#post({ type: 'ready' })
  }
  loading(file: string): void {
    this.#post({ type: 'loading', file })
  }
  reply(id: number, value: ReplyValue): void {
    this.#post({ type: 'reply', id, value })
  }
  timedOut(phase: ExecutionPhase | undefined): void {
    this.#post({ type: 'timeout', phase })
  }
  groupStage(path: number[], stage: Stage, timeoutMs: number): void {
    this.#post({ type: 'group-stage', path, stage, timeoutMs })
  }

  /** 畳めない失敗は親へ伝えてから口を閉じる。以降のcommandは届かない。 */
  fail<T>(error: T): void {
    this.#post({ type: 'error', message: errorStack(error) })
    this.#port.close()
  }

  /** 受け取った形はここで検証する。protocolに無い形は実行を続けられないため、そのまま投げる。 */
  onMessage(listener: (message: ExecutionIncoming) => void): void {
    this.#port.on('message', (input) => listener(v.parse(executionIncomingSchema, input)))
  }
}
