import { ObservationFault } from '../../application/execution/observation-fault.js'
import type { Value } from '../../domain/execution/javascript.js'
import type { ExecutionPhase } from '../../domain/result/types.js'
import type { Check } from '@hanamaru/blueprint/model'
import { RuntimeReference, referenceGraph, checkReferences, adapterTypeOf } from '@hanamaru/blueprint/model'
import type { AssertionReference, AssertionResult, Failure, ObservationResult } from '../../domain/result/types.js'
import { imageDiagnostic } from '../../domain/result/image-diagnostic.js'
import { diagnosticRecord } from '../../domain/result/diagnostic-record.js'
import { diagnostic } from '../../domain/result/diagnostic.js'
import type { EvaluationValues } from '../../application/execution/values.js'
import type { ContractEvaluation } from '../../application/execution/contract-evaluation.js'

function diagnosticResult(result: ReturnType<EvaluationValues['raw']>) {
  switch (result.kind) {
    case 'value':
      return diagnostic(result.value)
    case 'mismatch':
      return result.actual
    case 'missing':
      return { kind: 'omitted', reason: result.reason } as const
    case 'error':
      return { kind: 'omitted', reason: 'value could not be captured' } as const
  }
}
function rootOf(ref: RuntimeReference): RuntimeReference {
  return 'parent' in ref.source ? rootOf(ref.source.parent) : ref
}
function referenceOf(check: Check, index: number, contract: ContractEvaluation): AssertionReference {
  const refs = checkReferences(check)
  const types = new Set<object>(),
    graph = new Set<RuntimeReference>()
  for (const ref of refs) for (const entry of referenceGraph([ref], ref.owner)) graph.add(entry)
  const observations: ObservationResult[] = []
  for (const entry of graph) {
    const source = entry.source
    if (source.kind === 'error-type' || source.kind === 'outcome-error') types.add(source.ctor)
    if (source.kind === 'action' || source.kind === 'state') observations.push(contract.observation(entry))
  }
  const typeMetadata = {
    ...(types.size ? { errorTypes: [...types].map((type) => diagnostic(type)) } : {}),
    ...(observations.length ? { observations } : {}),
  }
  if (check.kind === 'predicate')
    return { source: 'expect', index, subject: 'property', matcher: 'satisfies', ...typeMetadata }
  const ref = check.kind === 'unchanged' ? check.after : check.ref
  const root = rootOf(ref).source
  const subject =
    root.kind === 'state' || root.kind === 'action' || root.kind === 'error' || root.kind === 'outcome'
      ? root.kind
      : 'result'
  const path: (string | number)[] = []
  let current = ref
  while ('parent' in current.source) {
    if (current.source.kind === 'field' || current.source.kind === 'alias')
      path.unshift(typeof current.source.key === 'symbol' ? String(current.source.key) : current.source.key)
    current = current.source.parent
  }
  return {
    source: 'expect',
    ...typeMetadata,
    ...(check.kind === 'equal' && check.adapter !== null
      ? { adapterType: diagnostic(adapterTypeOf(check.adapter)) }
      : {}),
    index,
    subject,
    matcher:
      check.kind === 'equal'
        ? 'toEqual'
        : check.kind === 'identity'
          ? 'toBe'
          : check.kind === 'close'
            ? 'toBeCloseTo'
            : check.kind,
    path,
    ...(root.kind === 'step' ? { operationIndex: root.operation } : {}),
    ...(root.kind === 'state' || root.kind === 'action' ? { evidence: root.token.evidence } : {}),
  }
}
export function pendingAssertions(
  contract: ContractEvaluation,
  reason = 'evaluation is still running',
): AssertionResult[] {
  return contract.compiled.conditions.map((condition, index) => ({
    assertion: referenceOf(condition.check, index, contract),
    status: 'not-evaluated',
    pending: true,
    failureIndexes: [],
    reason,
  }))
}

export function contractReport(
  contract: ContractEvaluation,
  captureFault?: { readonly causes: readonly Value[]; readonly phase: ExecutionPhase },
): { failures: Failure[]; assertions: AssertionResult[]; reportedCauses: Value[] } {
  const reportedCauses: Value[] = []
  const failures: Failure[] = [],
    assertions: AssertionResult[] = []
  for (const [index, result] of contract.evaluate().entries()) {
    const check = contract.compiled.conditions[index].check
    const assertion = referenceOf(check, index, contract)
    const before = check.kind === 'unchanged' ? contract.values.image(check.before) : null
    const expected =
      check.kind === 'close'
        ? diagnostic({ value: check.expected, absoluteTolerance: check.absoluteTolerance })
        : check.kind === 'equal'
          ? imageDiagnostic(check.expected)
          : before?.kind === 'value'
            ? imageDiagnostic(before.value)
            : diagnostic('expected' in check ? check.expected : check.kind === 'predicate' ? check.name : 'unchanged')
    const ref = check.kind === 'unchanged' ? check.after : 'ref' in check ? check.ref : null
    const image = ref === null ? null : contract.values.image(ref, check.kind === 'equal' ? check.adapter : null)
    const raw = ref === null ? null : check.kind === 'count' ? contract.values.count(ref) : contract.values.raw(ref)
    const actual =
      check.kind === 'predicate'
        ? check.refs instanceof RuntimeReference
          ? diagnosticResult(contract.values.data(check.refs))
          : diagnosticRecord(
              Object.entries(check.refs).map(([name, ref]) => [name, diagnosticResult(contract.values.data(ref))]),
            )
        : check.kind === 'close' && raw?.kind === 'value'
          ? diagnostic({
              value: raw.value,
              difference:
                typeof raw.value === 'number' && Number.isFinite(raw.value)
                  ? Math.abs(raw.value - check.expected)
                  : null,
            })
          : image?.kind === 'value'
            ? imageDiagnostic(image.value)
            : diagnosticResult(raw ?? { kind: 'missing', reason: 'value was not produced' })
    if (result.status === 'not-evaluated') {
      assertions.push({
        failureIndexes: [],
        assertion,
        status: 'not-evaluated',
        reason: result.reason,
        ...(result.pending ? { pending: true as const } : {}),
      })
    } else {
      if (result.status === 'error' && result.cause instanceof ObservationFault)
        assertions.push({ failureIndexes: [], assertion, status: 'not-evaluated', reason: result.cause.message })
      else
        assertions.push({
          failureIndexes: [],
          assertion,
          status: result.status === 'passed' ? 'passed' : 'failed',
          expected,
          actual,
        })
      if (result.status === 'failed')
        failures.push({ kind: 'assertion', phase: 'assert', message: result.reason, assertion, expected, actual })
      if (result.status === 'error') {
        reportedCauses.push(result.cause)
        failures.push(
          result.cause instanceof ObservationFault
            ? {
                kind: 'observation',
                phase: captureFault?.causes.includes(result.cause) ? captureFault.phase : result.phase,
                message: result.cause.message,
                observation: result.cause.observation,
                stage: result.cause.stage,
                cause: diagnostic(result.cause.cause),
                assertion,
              }
            : {
                kind: 'execution',
                phase: captureFault?.causes.includes(result.cause) ? captureFault.phase : result.phase,
                message: 'contract evaluation failed',
                cause: diagnostic(result.cause),
                assertion,
              },
        )
      }
    }
  }
  return { failures, assertions, reportedCauses }
}
