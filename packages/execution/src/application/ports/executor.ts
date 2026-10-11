import { Config } from '@zeltjs/core'
import type { GroupNode, Plan, SuiteNode } from '../../domain/execution/model.js'
import type { Fields, RuntimeCase } from '@hanamaru/blueprint/model'
import type { MutableAttempt, MutableGroupMiddleware, Reason } from '../../domain/result/mutable.js'
import type { RootReference } from './root-reference.js'
import type { ModuleInvoke, ModulePreparation } from '@hanamaru/module-runtime/application/ports/module-loader'

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

/** 実行場所が提供する試行と囲みの操作。計画の走査はapplicationのサービスが担当する。 */
export interface ExecutionHandle {
  attempt(node: SuiteNode, item: RuntimeCase, path: number[], number: number): Promise<AttemptReply>
  group(node: GroupNode, path: number[], body: (fields: Fields) => Promise<void>): Promise<GroupReply>
  close(): Promise<void>
}

/** 計画を待つ実行の持ち場。収集中の失敗でも開いた側が畳む。closeは何度呼んでも同じ終了を待つ。 */
export interface PreparedExecution {
  start(spec: ExecutionSpec, services: ExecutionServices): Promise<ExecutionHandle>
  close(): Promise<void>
}

/** 計画が決まる前に実行環境を起こす口。openは起動完了を待たず、収集と並行して準備する。 */
@Config({ abstract: true })
export abstract class ExecutionLauncher implements ExecutionHandle {
  abstract open(): PreparedExecution
  abstract initialize(plan: Plan, roots: RootReference[], signal: AbortSignal, timeout: number): Promise<void>
  abstract attempt(node: SuiteNode, item: RuntimeCase, path: number[], number: number): Promise<AttemptReply>
  abstract group(node: GroupNode, path: number[], body: (fields: Fields) => Promise<void>): Promise<GroupReply>
  abstract close(): Promise<void>
}
