import { Config } from '@zeltjs/core'
import type { MutableAttempt, MutableGroupMiddleware, Reason } from '../../domain/result/mutable.js'
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
 * attemptとgroupを別の場所で走らせる実行場所。
 * 何を走らせるかも外との繋ぎ方も収集が終わるまで決まらないため、どちらもstartで受け取る。
 */
@Config({ abstract: true })
export abstract class Executor {
  abstract start(spec: ExecutionSpec, services: ExecutionServices): Promise<void>
  abstract attempt(path: number[], number: number): Promise<AttemptReply>
  abstract group(path: number[], body: () => Promise<boolean>): Promise<GroupReply>
  abstract close(): Promise<void>
}

/**
 * 計画を辿る側から見た実行場所の有無。
 * ライブラリのrunは手元で走らせるため実行場所を持たず、収集workerは実行workerを指す。
 */
@Config({ abstract: true })
export abstract class ExecutionPlace {
  abstract readonly executor: Executor | null
}

/** 手元で走らせるrunの実行場所。ライブラリのrunがこれを選ぶ。 */
@Config()
export class LocalExecution extends ExecutionPlace {
  readonly executor: Executor | null = null
}
