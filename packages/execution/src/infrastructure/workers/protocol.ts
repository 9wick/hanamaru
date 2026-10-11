import type { Fields } from '@hanamaru/blueprint/model'
import type { Stage } from '../../application/execution/state.js'
import type { AttemptReply, PreparedExecution, GroupReply } from '../../application/ports/executor.js'
import type { RootReference } from '../../application/ports/root-reference.js'
import type { ModulePreparation } from '@hanamaru/module-runtime/application/ports/module-loader'
import type { ExecutionPhase } from '../../domain/result/types.js'
import type { Value } from '../../domain/execution/javascript.js'

export interface ExecutionWorkerData {
  roots: RootReference[]
  preparation: ModulePreparation[]
  shape: string
}

export type ExecutionCommand =
  | { type: 'attempt'; id: number; path: number[]; number: number; resourceFields?: Fields }
  | { type: 'group-open'; id: number; path: number[]; resourceFields?: Fields }
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
  | { type: 'initialize'; spec: ExecutionWorkerData }
  | { type: 'interrupt' }
  | { type: 'compiled'; id: number; result?: Value; error?: string }

export type ExecutionClient = PreparedExecution
