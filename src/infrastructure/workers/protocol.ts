import type { CliOptions } from '../../application/collection/options.js'
import type { Stage } from '../../application/execution/state.js'
import type { AttemptReply, Executor, GroupReply } from '../../application/ports/executor.js'
import type { ModulePreparation, RootReference } from '../../application/ports/module-loader.js'
import type { ExecutionPhase } from '../../domain/result/types.js'
import type { Value } from '../../foundation/value.js'

export interface CliWorkerData {
  files: string[]
  options: CliOptions
}

export type { CliMessage, Reporter } from '../../application/collection/events.js'

export interface ExecutionWorkerData {
  roots: RootReference[]
  preparation: ModulePreparation[]
  shape: string
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
  | { type: 'compile'; id: number; name: string; args: Value[] }
  | { type: 'ready' }
  | { type: 'loading'; file: string }
  | { type: 'error'; message: string }
  | { type: 'reply'; id: number; value: ReplyValue }
  | { type: 'timeout'; phase?: ExecutionPhase }
  | { type: 'group-stage'; path: number[]; stage: Stage; timeoutMs: number }

export type ExecutionIncoming =
  | ExecutionCommand
  | { type: 'interrupt' }
  | { type: 'compiled'; id: number; result?: Value; error?: string }

export type ExecutionClient = Executor
