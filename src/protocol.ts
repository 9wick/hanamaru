import type { ExecutionPhase } from './api.js'
import type { AttemptReply, Executor, GroupReply, ModulePreparation, RootReference, Stage } from './internal.js'
import type { describeExecutionPlan } from './execution-plan.js'

export type ModuleInvoke = (name: string, args: unknown[]) => Promise<unknown>
export interface ExecutionWorkerData {
  roots: RootReference[]
  preparation: ModulePreparation[]
  shape: ReturnType<typeof describeExecutionPlan>
}
export type ExecutionCommand =
  | { type: 'attempt'; id: number; path: number[]; number: number }
  | { type: 'group-open'; id: number; path: number[] }
  | { type: 'group-close'; id: number; path: number[]; failed: boolean }
export type CommandInput = ExecutionCommand extends infer C
  ? C extends ExecutionCommand
    ? Omit<C, 'id'>
    : never
  : never
export type ReplyValue = AttemptReply | GroupReply | { entered: true }
export type ExecutionMessage =
  | { type: 'compile'; id: number; name: string; args: unknown[] }
  | { type: 'ready' }
  | { type: 'loading'; file: string }
  | { type: 'error'; message: string }
  | { type: 'reply'; id: number; value: ReplyValue }
  | { type: 'timeout'; phase?: ExecutionPhase }
  | { type: 'group-stage'; path: number[]; stage: Stage; timeoutMs: number }
export type ExecutionIncoming =
  | ExecutionCommand
  | { type: 'interrupt' }
  | { type: 'compiled'; id: number; result?: unknown; error?: string }
export interface ExecutionOptions extends ExecutionWorkerData {
  signal?: AbortSignal
  onLoading: (file: string) => void
  invoke: ModuleInvoke
}
export type ExecutionClient = Executor
