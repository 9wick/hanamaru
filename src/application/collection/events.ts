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

/**
 * 収集の進み具合をCLIへ知らせる手。送り先そのものは実行環境ごとに違うため入口が渡し、
 * protocolの形(CliMessage)を組み立てる責任だけをここに閉じ込める。
 */
export class CollectionEvents {
  readonly #send: (event: CliMessage) => void

  constructor(send: (event: CliMessage) => void) {
    this.#send = send
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
