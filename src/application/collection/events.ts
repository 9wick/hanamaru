import type { MutableRunResult } from '../../domain/result/mutable.js'
import type { Deadline, Progress } from '../execution/state.js'
export type Reporter = 'pretty' | 'json'

export type CliMessage =
  | { type: 'loading'; file: string; timeout: number }
  | { type: 'running'; reporter: Reporter; shutdownGrace: number }
  | { type: 'progress'; progress: Progress }
  | { type: 'timeout'; result: MutableRunResult }
  | ({ type: 'deadline' } & Deadline)
  | { type: 'result'; result: MutableRunResult; reporter: Reporter }
  | { type: 'error'; message: string }
