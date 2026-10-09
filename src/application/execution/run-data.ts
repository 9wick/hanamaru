import type { MutableResourceResult, MutableRunResult, Reason } from '../../domain/result/mutable.js'
import type { ExecutionPhase } from '../../domain/result/types.js'
import type { ActiveExecution } from './state.js'

/** 1回のrunに属する値。サービスと通知先は保持しない。 */
export interface RunData {
  reason: Reason | null
  active: ActiveExecution | null
  phase: ExecutionPhase | null
  result: MutableRunResult | null
  readonly resources: MutableResourceResult[]
}

export function createRunData(): RunData {
  return { reason: null, active: null, phase: null, result: null, resources: [] }
}
