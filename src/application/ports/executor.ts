import { Config } from '@zeltjs/core'
import type { Fields, RuntimeCase } from '../../domain/definition/runtime.js'
import type { GroupNode, SuiteNode } from '../../domain/execution/model.js'
import type { MutableAttempt, MutableGroupMiddleware, Reason } from '../../domain/result/mutable.js'
import type { RunEvents } from '../execution/services.js'
import type { ModuleInvoke, ModulePreparation, RootReference } from './module-loader.js'

export interface AttemptReply {
  result: MutableAttempt
  retryable: boolean
  reason?: Reason | null
}

export interface GroupReply {
  middleware: MutableGroupMiddleware
  reason: Reason | null
  entered?: false
}

/** 実行側へ渡す計画。値だけで構成する。 */
export interface ExecutionSpec {
  roots: RootReference[]
  preparation: ModulePreparation[]
  shape: string
}

/** 実行側が外とやりとりする手段。 */
export interface ExecutionServices {
  invoke: ModuleInvoke
  signal: AbortSignal
  onLoading: (file: string) => void
}

/**
 * 1回のrunぶんの実行の持ち場。計画を辿る側は、手元で走らせるか別の場所へ渡すかを知らずに同じ形で頼む。
 * 節そのものは手元で走らせる側が、pathは別の場所へ渡す側が見る。どちらを使うかは持ち場が決める。
 */
export interface ExecutionHandle {
  attempt(node: SuiteNode, item: RuntimeCase, path: number[], number: number): Promise<AttemptReply>
  group(node: GroupNode, path: number[], body: (fields: Fields) => Promise<void>): Promise<GroupReply>
  close(): Promise<void>
}

/**
 * 実行の持ち場を開く口。
 * 通知の受け取り手も何を走らせるかも外との繋ぎ方も収集が終わるまで決まらないため、どれもstartで受け取る。
 */
@Config({ abstract: true })
export abstract class Executor {
  abstract start(events: RunEvents, spec: ExecutionSpec, services: ExecutionServices): Promise<ExecutionHandle>
}
