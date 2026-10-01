import { Injectable } from '@zeltjs/core'
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

/**
 * 計画の根ごとの出どころ。収集した並びと計画が揃ってはじめて引けるため、
 * 収集の手順が組み上がった時点で記録する。
 */
@Injectable()
export class RunSources {
  #byNode: readonly TestSource[] = []

  record(nodes: readonly ExecutionNode[], sources: readonly TestSource[]): void {
    this.#byNode = nodes.map((node) => sources[node.rootIndex])
  }

  /** 木の根へ出どころを付けた複製を返す。 */
  attach(result: MutableRunResult): MutableRunResult {
    return { ...result, tests: result.tests.map((node) => ({ ...node, source: this.#byNode[node.path[0]] })) }
  }
}

/**
 * 収集workerが実行の通知を受ける手。親へ渡す結果だけは出どころを付けた姿にする。
 * 部分結果ツリーはこのworkerが持つため、打ち切り時の姿もここで組み立てる。
 * 出どころは計画が組み上がってはじめて引けるため、1回のrunごとに組み立てる。
 */
export class CollectionRunEvents extends RunEvents {
  readonly #events: CollectionEvents
  readonly #sources: RunSources
  readonly #snapshot: RunSnapshot

  constructor(events: CollectionEvents, sources: RunSources, snapshot: RunSnapshot) {
    super()
    this.#events = events
    this.#sources = sources
    this.#snapshot = snapshot
  }

  progress(progress: Progress): void {
    this.#events.progress(
      progress.kind === 'init' ? { ...progress, result: this.#sources.attach(progress.result) } : progress,
    )
  }

  deadline(deadline: Deadline): void {
    this.#events.deadline(deadline)
  }

  timedOut(): void {
    this.#events.timedOut(this.#sources.attach(this.#snapshot.capture('timeout')))
  }
}
