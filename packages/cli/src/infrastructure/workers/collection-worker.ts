import type { MessagePort } from 'node:worker_threads'
import { WorkerExecutionLauncher } from '@hanamaru/runner/infrastructure/workers/client'
import { Injectable, inject } from '@zeltjs/core'
import { CollectionSession } from '../collection/session.js'
import { CollectionReporter } from '../collection/reporting.js'
import { errorStack } from '../../application/collection/failure.js'
import type { CollectionRequest } from '../../application/ports/collection-runner.js'
import { CollectionChannel } from './collection-channel.js'

/** 収集workerが受け持つ1回ぶんの流れ。親からの中断はこのrunだけに効く。 */
@Injectable()
export class CollectionWorker {
  readonly #execution: WorkerExecutionLauncher
  readonly #channel: CollectionChannel
  readonly #session: CollectionSession
  readonly #reporter: CollectionReporter

  constructor(
    channel = inject(CollectionChannel),
    execution = inject(WorkerExecutionLauncher),
    session = inject(CollectionSession),
    reporter = inject(CollectionReporter),
  ) {
    this.#execution = execution
    this.#channel = channel
    this.#session = session
    this.#reporter = reporter
  }

  run(request: CollectionRequest, port: MessagePort, executionPort: MessagePort): Promise<void> {
    this.#channel.connect(port)
    this.#execution.connect(executionPort, () => this.#channel.closeExecution())
    const controller = new AbortController()
    this.#channel.onInterrupt(() => controller.abort())
    return this.#session.run(request, controller.signal)
  }

  /** 起動後の終了処理で起きた失敗も、収集の失敗と同じ通り道へ知らせる。 */
  fail(error: unknown): void {
    const released: unknown = error instanceof AggregateError && error.errors.length === 1 ? error.errors[0] : error
    this.#reporter.error(errorStack(released))
  }
}
