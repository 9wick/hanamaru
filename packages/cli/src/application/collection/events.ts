import { Config } from '@zeltjs/core'
import type { MutableRunResult } from '@hanamaru/execution/domain/result/mutable'
import type { Deadline, Progress } from '@hanamaru/execution/application/execution/state'
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
