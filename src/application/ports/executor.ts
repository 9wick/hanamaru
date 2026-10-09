import { Config } from '@zeltjs/core'
import type { RunSettings } from '../execution/options.js'
import type { Plan } from '../../domain/execution/model.js'
import type { MutableAttempt, MutableGroupMiddleware, MutableRunResult, Reason } from '../../domain/result/mutable.js'
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

/** 計画を実行して結果を返す。ローカルかworkerかに関わらず、走査も実行側の責務とする。 */
export interface ExecutionHandle {
  run(buildPlan: () => Plan, settings: RunSettings, signal?: AbortSignal): Promise<MutableRunResult>
  close(): Promise<void>
}

/** 計画を待つ実行の持ち場。収集中の失敗でも開いた側が畳む。closeは何度呼んでも同じ終了を待つ。 */
export interface PreparedExecution {
  start(spec: ExecutionSpec, services: ExecutionServices): Promise<ExecutionHandle>
  close(): Promise<void>
}

/** 計画が決まる前に実行環境を起こす口。openは起動完了を待たず、収集と並行して準備する。 */
@Config({ abstract: true })
export abstract class ExecutionLauncher {
  abstract open(): PreparedExecution
}
