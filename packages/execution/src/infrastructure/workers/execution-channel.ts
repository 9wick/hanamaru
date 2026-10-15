import { Injectable, inject } from '@zeltjs/core'
import type { MessagePort } from 'node:worker_threads'
import * as v from 'valibot'
import type { Stage } from '../../application/execution/state.js'
import { ExecutionLifecycle } from '../../application/execution/lifecycle.js'
import { errorStack } from '../../domain/result/exception.js'
import type { Value } from '../../domain/execution/javascript.js'
import type { ExecutionIncoming, ExecutionMessage, ReplyValue } from '@hanamaru/execution-protocol/data'
import { transportValueSchema, executionIncomingSchema } from './execution-schemas.js'

/** 収集workerと実行workerを繋ぐ専用MessagePort。protocolの形を組み立てて送受信するのはここだけにする。 */
@Injectable()
export class ExecutionChannel {
  #connection: MessagePort | undefined

  constructor(lifecycle = inject(ExecutionLifecycle)) {
    lifecycle.observe((event) => {
      if (event.kind === 'timeout') this.#post({ type: 'timeout', phase: event.phase ?? undefined })
    })
  }

  connect(port: MessagePort): void {
    if (this.#connection) throw new Error('execution channel is already connected')
    this.#connection = port
  }

  get #port(): MessagePort {
    if (!this.#connection) throw new Error('execution channel is not connected')
    return this.#connection
  }

  #post(message: ExecutionMessage): void {
    this.#port.postMessage(message)
  }

  compile(request: { id: number; name: string; args: Value[] }): void {
    this.#post({ type: 'compile', ...request, args: v.parse(v.array(transportValueSchema), request.args) })
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
  groupStage(path: number[], stage: Stage, timeoutMs: number): void {
    this.#post({ type: 'group-stage', path, stage, timeoutMs })
  }

  /** 畳めない失敗は収集workerへ伝えてから口を閉じる。以降のcommandは届かない。 */
  fail<T>(error: T): void {
    this.#post({ type: 'error', message: errorStack(error) })
    this.#port.close()
  }

  /** 受け取った形はここで検証する。protocolに無い形は実行を続けられないため、そのまま投げる。 */
  onMessage(listener: (message: ExecutionIncoming) => void): void {
    this.#port.on('message', (input) => listener(v.parse(executionIncomingSchema, input)))
  }
}
