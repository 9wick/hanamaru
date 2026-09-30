import type { Value } from '../../foundation/value.js'

export class CaseFailed extends Error {
  constructor() {
    super('case failed')
  }
}

export class MiddlewareFault extends Error {
  override cause: Value
  stage: 'before' | 'after' | 'contract'
  kind: 'execution' | 'timeout'
  timeoutMs: number | undefined
  constructor(
    cause: Value,
    stage: 'before' | 'after' | 'contract',
    kind: 'execution' | 'timeout' = 'execution',
    timeoutMs?: number,
  ) {
    super(kind === 'timeout' ? `middleware ${stage} exceeded ${timeoutMs}ms` : `middleware ${stage} failed`)
    this.cause = cause
    this.stage = stage
    this.kind = kind
    this.timeoutMs = timeoutMs
  }
}

export class CleanupFault extends Error {
  errors: Value[]
  incomplete: boolean
  constructor(errors: Value[], incomplete = true) {
    super('cleanup failed')
    this.errors = errors
    this.incomplete = incomplete
  }
}
