import * as v from 'valibot'
import { failureSchema } from '@hanamaru/execution-protocol'
import type { Failure } from '@hanamaru/execution-protocol/data'
export function failure<K extends Failure['kind']>(
  kind: K,
  phase: Extract<Failure, { kind: K }>['phase'],
  message: string,
  more: Omit<Extract<Failure, { kind: K }>, 'kind' | 'phase' | 'message'>,
): Failure {
  return v.parse(failureSchema, { kind, phase, message, ...more })
}
