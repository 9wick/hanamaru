import { Injectable, inject } from '@zeltjs/core'
import { CollectionSession } from '../../application/collection/session.js'
import { CollectionReporter } from '../../application/collection/reporting.js'
import { errorStack } from '../../application/collection/failure.js'
import type { CollectionRequest } from '../../application/ports/collection-runner.js'
import { CollectionChannel } from './collection-channel.js'

/** 収集workerが受け持つ1回ぶんの流れ。親からの中断はこのrunだけに効く。 */
@Injectable()
export class CollectionWorker {
  readonly #channel: CollectionChannel
  readonly #session: CollectionSession
  readonly #reporter: CollectionReporter

  constructor(
    channel = inject(CollectionChannel),
    session = inject(CollectionSession),
    reporter = inject(CollectionReporter),
  ) {
    this.#channel = channel
    this.#session = session
    this.#reporter = reporter
  }

  run(request: CollectionRequest): Promise<void> {
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
