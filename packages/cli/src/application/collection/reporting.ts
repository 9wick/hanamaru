import type { TargetCatalogue } from '@hanamaru/runner/domain/execution/targets'
import { Injectable, inject } from '@zeltjs/core'
import type { MutableRunResult } from '@hanamaru/runner/domain/result/mutable'
import type { Deadline, Progress, RunEvent } from '@hanamaru/runner/application/execution/state'
import { RunLifecycle } from '@hanamaru/runner/application/execution/lifecycle'
import type { CliMessage, Reporter } from './events.js'
import { CollectionSink } from './events.js'

/**
 * 収集の進み具合をCLIへ知らせる手。
 * protocolの形(CliMessage)を組み立てる責任だけをここに閉じ込め、送り先は通り道に委ねる。
 */
@Injectable()
export class CollectionReporter {
  readonly #sink: CollectionSink
  readonly #lifecycle: RunLifecycle
  #presentation: { reporter: Reporter; shutdownGrace: number } | null = null

  constructor(sink = inject(CollectionSink), lifecycle = inject(RunLifecycle)) {
    this.#sink = sink
    this.#lifecycle = lifecycle
    lifecycle.observe((event) => this.#executionEvent(event))
  }

  presentation(reporter: Reporter, shutdownGrace: number): void {
    this.#presentation = { reporter, shutdownGrace }
  }

  #executionEvent(event: RunEvent): void {
    if (event.kind === 'initialized') {
      if (this.#presentation) this.running(this.#presentation.reporter, this.#presentation.shutdownGrace)
    } else if (event.kind === 'loading') this.loading(event.file, event.timeout)
    else if (event.kind === 'progress') {
      const progress = event.progress
      this.progress(progress)
    } else if (event.kind === 'deadline') this.deadline(event.deadline)
    else if (event.kind === 'timeout') this.timedOut(this.#lifecycle.capture('timeout'))
  }

  #send(event: CliMessage): void {
    this.#sink.post(event)
  }

  loading(file: string, timeout: number): void {
    this.#send({ type: 'loading', file, timeout })
  }
  running(reporter: Reporter, shutdownGrace: number): void {
    this.#send({ type: 'running', reporter, shutdownGrace })
  }
  progress(progress: Progress): void {
    this.#send({ type: 'progress', progress })
  }
  timedOut(result: MutableRunResult): void {
    this.#send({ type: 'timeout', result })
  }
  deadline(deadline: Deadline): void {
    this.#send({ type: 'deadline', ...deadline })
  }
  catalogue(catalogue: TargetCatalogue, reporter: Reporter): void {
    this.#send({ type: 'catalogue', catalogue, reporter })
  }
  result(result: MutableRunResult, reporter: Reporter): void {
    this.#send({ type: 'result', result, reporter })
  }
  error(message: string): void {
    this.#send({ type: 'error', message })
  }
}
