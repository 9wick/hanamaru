import type { MutableAttempt, MutableGroupMiddleware, Reason } from '../../domain/result/mutable.js'
import type { RunEvents, RunTracker } from '../execution/services.js'

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

export interface Executor {
  attach(tracker: RunTracker, events: RunEvents): void
  attempt(path: number[], number: number): Promise<AttemptReply>
  group(path: number[], body: () => Promise<boolean>): Promise<GroupReply>
  close(): Promise<void>
}
