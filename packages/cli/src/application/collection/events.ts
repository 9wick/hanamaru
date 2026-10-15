import type { TargetCatalogue } from '@hanamaru/runner/domain/execution/targets'
import type { MutableRunResult } from '@hanamaru/runner/domain/result/mutable'
import type { Deadline, Progress } from '@hanamaru/runner/application/execution/state'
export type Reporter = 'pretty' | 'json'

export type CliMessage =
  | { type: 'catalogue'; catalogue: TargetCatalogue; reporter: Reporter }
  | { type: 'loading'; file: string; timeout: number }
  | { type: 'running'; reporter: Reporter; shutdownGrace: number }
  | { type: 'progress'; progress: Progress }
  | { type: 'timeout'; result: MutableRunResult }
  | ({ type: 'deadline' } & Deadline)
  | { type: 'result'; result: MutableRunResult; reporter: Reporter }
  | { type: 'error'; message: string }
