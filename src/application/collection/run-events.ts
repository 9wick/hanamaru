import type { ExecutionNode } from '../../domain/execution/model.js'
import type { MutableRunResult } from '../../domain/result/mutable.js'
import type { RunSnapshot } from '../execution/services.js'
import { RunEvents } from '../execution/services.js'
import type { Deadline, Progress } from '../execution/state.js'
import type { CollectionEvents } from './events.js'

/** どのファイルのどのprojectから来た根か。 */
export interface TestSource {
  file: string
  projects: string[]
}

/** 計画の節ごとの出どころ。収集した並びと計画が揃ってはじめて引けるため、計画が組み上がった時点で引く。 */
export function nodeSources(nodes: readonly ExecutionNode[], sources: readonly TestSource[]): readonly TestSource[] {
  return nodes.map((node) => sources[node.rootIndex])
}

/** 木の根へ出どころを付けた複製を返す。 */
export function withSources(result: MutableRunResult, byNode: readonly TestSource[]): MutableRunResult {
  return { ...result, tests: result.tests.map((node) => ({ ...node, source: byNode[node.path[0]] })) }
}

/**
 * 収集workerが実行の通知を受ける手。親へ渡す結果だけは出どころを付けた姿にする。
 * 部分結果ツリーはこのworkerが持つため、打ち切り時の姿もここで組み立てる。
 * 出どころは計画が組み上がってはじめて引けるため、1回のrunごとに組み立てる。
 */
export class CollectionRunEvents extends RunEvents {
  readonly #events: CollectionEvents
  readonly #sources: readonly TestSource[]
  readonly #snapshot: RunSnapshot

  constructor(events: CollectionEvents, sources: readonly TestSource[], snapshot: RunSnapshot) {
    super()
    this.#events = events
    this.#sources = sources
    this.#snapshot = snapshot
  }

  progress(progress: Progress): void {
    this.#events.progress(
      progress.kind === 'init' ? { ...progress, result: withSources(progress.result, this.#sources) } : progress,
    )
  }

  deadline(deadline: Deadline): void {
    this.#events.deadline(deadline)
  }

  timedOut(): void {
    this.#events.timedOut(withSources(this.#snapshot.capture('timeout'), this.#sources))
  }
}
