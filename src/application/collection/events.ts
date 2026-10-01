import { Config, Injectable, inject } from '@zeltjs/core'
import type { MutableRunResult } from '../../domain/result/mutable.js'
import type { Deadline, Progress } from '../execution/state.js'
export type Reporter = 'pretty' | 'json'

export type CliMessage =
  | { type: 'loading'; file: string; timeout: number }
  | { type: 'running'; reporter: Reporter; shutdownGrace: number }
  | { type: 'progress'; progress: Progress }
  | { type: 'timeout'; result: MutableRunResult }
  | ({ type: 'deadline' } & Deadline)
  | { type: 'result'; result: MutableRunResult; reporter: Reporter }
  | { type: 'error'; message: string }

/** 組み立てたprotocolの形を外へ流す通り道。実行環境ごとに違うため、infrastructureが用意する。 */
@Config({ abstract: true })
export abstract class CollectionSink {
  abstract post(event: CliMessage): void
}

/**
 * 収集の進み具合をCLIへ知らせる手。
 * protocolの形(CliMessage)を組み立てる責任だけをここに閉じ込め、送り先は通り道に委ねる。
 */
@Injectable()
export class CollectionEvents {
  readonly #sink: CollectionSink

  constructor(sink = inject(CollectionSink)) {
    this.#sink = sink
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
