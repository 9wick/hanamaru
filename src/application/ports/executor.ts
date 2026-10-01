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

/** attemptとgroupを別の場所で走らせる実行場所。何を走らせるかはstartで受け取る。 */
export interface Executor {
  start(spec: ExecutionSpec): Promise<void>
  attempt(path: number[], number: number): Promise<AttemptReply>
  group(path: number[], body: () => Promise<boolean>): Promise<GroupReply>
  close(): Promise<void>
}
