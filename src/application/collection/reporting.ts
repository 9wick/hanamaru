import { Injectable, inject } from '@zeltjs/core'
import type { MutableRunResult } from '../../domain/result/mutable.js'
import type { Deadline, Progress, RunEvent } from '../execution/state.js'
import { RunLifecycle } from '../execution/lifecycle.js'
import type { TestSource } from './sources.js'
import { withSources } from './sources.js'
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
  #sources: readonly TestSource[] = []

  constructor(sink = inject(CollectionSink), lifecycle = inject(RunLifecycle)) {
    this.#sink = sink
    this.#lifecycle = lifecycle
    lifecycle.observe((event) => this.#executionEvent(event))
  }

  /** 計画が確定してから得られる出典だけを、通信に使うデータとして受け取る。 */
  sources(sources: readonly TestSource[]): void {
    this.#sources = sources
  }

  #executionEvent(event: RunEvent): void {
    if (event.kind === 'progress') {
      const progress = event.progress
      this.progress(
        progress.kind === 'init' ? { ...progress, result: withSources(progress.result, this.#sources) } : progress,
      )
    } else if (event.kind === 'deadline') this.deadline(event.deadline)
    else this.timedOut(withSources(this.#lifecycle.capture('timeout'), this.#sources))
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
  result(result: MutableRunResult, reporter: Reporter): void {
    this.#send({ type: 'result', result, reporter })
  }
  error(message: string): void {
    this.#send({ type: 'error', message })
  }
}
