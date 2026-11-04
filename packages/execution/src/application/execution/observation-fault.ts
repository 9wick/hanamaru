import { referenceGraph, RuntimeReference } from '@hanamaru/blueprint/model'
import type { Value } from '../../domain/execution/javascript.js'
import { diagnostic } from '../../domain/result/diagnostic.js'
import type { ObservationResult } from '../../domain/result/types.js'
import type { EvaluationValues } from './values.js'

export function observationResult(ref: RuntimeReference, values: EvaluationValues): ObservationResult {
  const source = ref.source
  if (source.kind !== 'state' && source.kind !== 'action') throw new TypeError('expected observation reference')
  const common = { refId: ref.id, tokenId: source.token.id, evidence: source.token.evidence }
  if (source.kind === 'action') return { ...common, kind: 'action', window: source.window }
  const args = source.args.map((arg) => {
    if (arg.kind === 'value') return diagnostic(arg.value)
    const saved = values.data(arg.ref)
    return saved.kind === 'value'
      ? diagnostic(saved.value)
      : ({ kind: 'omitted', reason: 'observation argument is unavailable' } as const)
  })
  let timing: Extract<ObservationResult, { kind: 'state' }>['timing']
  if (source.timing.kind === 'after-step') {
    const step = referenceGraph([source.timing.step], ref.owner).find((entry) => entry.source.kind === 'step')
    if (step?.source.kind !== 'step') throw new TypeError('compiled checkpoint is missing')
    timing = { kind: 'after-step', operationIndex: step.source.operation }
  } else timing = source.timing
  return { ...common, kind: 'state', args, timing }
}

export class ObservationFault extends Error {
  readonly observation: ObservationResult
  readonly stage: 'before' | 'after' | 'open' | 'finish' | 'dispose'
  override readonly cause: Value
  constructor(observation: ObservationResult, stage: ObservationFault['stage'], cause: Value) {
    super(`observation ${stage} failed`, { cause })
    this.observation = observation
    this.stage = stage
    this.cause = cause
  }
}
