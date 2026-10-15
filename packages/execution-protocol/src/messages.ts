import type { MutableAttempt, MutableGroupMiddleware, Reason, ExecutionPhase } from './result-types.js'
import type { TransportValue } from './value.js'
type Value = TransportValue
type Fields = Record<string, TransportValue>
export type Stage = 'before' | 'inside' | 'after' | 'end' | 'contract'
export interface RootReference {
  file: string
  index: number
  origin: { file: string; line: number; column: number }
}
export interface ModulePreparation {
  id: string
  keys: string[]
}
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
export interface ExecutionWorkerData {
  readonly entryURL?: string
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
