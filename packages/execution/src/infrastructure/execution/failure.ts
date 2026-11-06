import { ObservationFault } from '../../application/execution/observation-fault.js'
import * as v from 'valibot'
import { failureSchema } from '../../domain/result/schemas.js'
import type { ExecutionPhase, Failure } from '../../domain/result/types.js'
import { diagnostic } from '../../domain/result/diagnostic.js'
import { errorMessage } from '../../domain/result/exception.js'
import { required, valueOf } from '../../domain/execution/javascript.js'
import { MiddlewareFault } from '../../application/execution/faults.js'

export function failure<K extends Failure['kind']>(
  kind: K,
  phase: Extract<Failure, { kind: K }>['phase'],
  message: string,
  more: Omit<Extract<Failure, { kind: K }>, 'kind' | 'phase' | 'message'>,
): Failure {
  return v.parse(failureSchema, { kind, phase, message, ...more })
}

export function faultToFailure<T>(input: T, phase: ExecutionPhase = 'prepare'): Failure {
  const error = valueOf(input)
  if (error instanceof ObservationFault)
    return failure('observation', phase, error.message, {
      observation: error.observation,
      stage: error.stage,
      cause: diagnostic(error.cause),
    })
  if (error instanceof MiddlewareFault)
    return error.kind === 'timeout'
      ? failure('timeout', phase, error.message, {
          timeoutMs: required(error.timeoutMs),
          cleanup: 'complete',
          ...(error.stage === 'contract' ? {} : { stage: error.stage }),
        })
      : failure('execution', phase, error.message, { cause: diagnostic(error.cause) })
  return failure('execution', phase, errorMessage(error), { cause: diagnostic(error) })
}
