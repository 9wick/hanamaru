import { withFailureReferences } from '@hanamaru/execution-protocol'
import { captureValue, copyData, equalValues, generate, seeded, shrink } from '@hanamaru/blueprint/model'
import type { PropertyInput, ValueImage } from '@hanamaru/blueprint/model'
import type { Value } from '../../domain/execution/javascript.js'
import { arrayValue } from '../../domain/execution/javascript.js'
import { diagnostic } from '../../domain/result/diagnostic.js'
import type { AttemptReply } from '../ports/executor.js'
import type {
  Failure,
  EvaluationResult,
  PropertyRun,
  MutableAttempt,
  ExecutionPhase,
} from '../../domain/result/types.js'

/** 各候補の評価器は環境の準備から後始末までを一度実行する。 */
export async function runProperty(
  input: PropertyInput,
  evaluate: (
    sample: Value[],
    report?: (result: MutableAttempt, phase: ExecutionPhase) => void,
  ) => Promise<AttemptReply>,
  active: () => boolean,
  progress?: (result: MutableAttempt, phase: ExecutionPhase) => void,
): Promise<AttemptReply> {
  const seed = input.seed ?? Math.floor(Math.random() * 0x100000000)
  let random = seeded(seed)
  const evaluations: EvaluationResult[] = [],
    failures: Failure[] = [],
    seen: ValueImage[] = []
  const shrinkPath: number[] = []
  const replyIndexes = new WeakMap<AttemptReply, readonly number[]>()
  const replyEvaluations = new WeakMap<AttemptReply, number>()
  let adopted: AttemptReply | undefined
  const started = performance.now()
  let originalCounterexample: PropertyRun['originalCounterexample'] = null
  let counterexample: PropertyRun['counterexample'] = null
  let stopped: PropertyRun['stopped'] = 'completed'
  async function run(
    sample: Value[],
    kind: Exclude<EvaluationResult['kind'], 'example'>,
    sampleIndex: number,
  ): Promise<AttemptReply> {
    const saved = diagnostic(sample)
    const remember = (result: MutableAttempt) => {
      if (
        originalCounterexample === null &&
        result.failures.every((failure) => failure.kind === 'assertion' || failure.kind === 'outcome') &&
        result.failures.some((failure) => failure.kind === 'assertion' || failure.kind === 'outcome')
      ) {
        originalCounterexample = saved
        counterexample = saved
        stopped = 'counterexample'
      }
    }
    const reply = await evaluate(
      arrayValue(copyData(sample)),
      progress === undefined
        ? undefined
        : (partial, phase) => {
            const offset = failures.length
            const pending: EvaluationResult = {
              kind,
              sampleIndex,
              input: saved,
              operations: partial.operations ?? [],
              expectedTermination: partial.expectedTermination ?? null,
              terminationTarget: partial.terminationTarget ?? null,
              status: partial.status,
              outcome: partial.outcome,
              assertions: partial.assertions,
              failureIndexes: partial.failures.map((_, index) => offset + index),
              cleanup: partial.cleanup,
            }
            const combined = finish({ result: partial, retryable: false }).result
            const provisional =
              originalCounterexample === null &&
              partial.failures.length > 0 &&
              partial.failures.every((failure) => failure.kind === 'assertion' || failure.kind === 'outcome')
            progress(
              withFailureReferences({
                ...combined,
                selectedEvaluationIndex: adopted ? replyEvaluations.get(adopted) : evaluations.length,
                ...(provisional && combined.property
                  ? {
                      property: {
                        ...combined.property,
                        originalCounterexample: saved,
                        counterexample: saved,
                        stopped: 'counterexample',
                      },
                    }
                  : {}),
                status: failures.length || partial.failures.length ? 'failed' : 'cancelled',
                failures: [...failures, ...partial.failures],
                evaluations: [...evaluations, pending],
              }),
              phase,
            )
          },
    )
    remember(reply.result)
    const offset = failures.length
    replyIndexes.set(
      reply,
      reply.result.failures.map((_, index) => offset + index),
    )
    replyEvaluations.set(reply, evaluations.length)
    failures.push(...reply.result.failures)
    evaluations.push({
      kind,
      sampleIndex,
      input: saved,
      operations: reply.result.operations ?? [],
      expectedTermination: reply.result.expectedTermination ?? null,
      terminationTarget: reply.result.terminationTarget ?? null,
      status: reply.result.status,
      outcome: reply.result.outcome,
      assertions: reply.result.assertions,
      failureIndexes: reply.result.failures.map((_, index) => offset + index),
      cleanup: reply.result.cleanup,
    })
    return reply
  }
  function finish(reply: AttemptReply): AttemptReply {
    const selected = adopted ?? reply
    const selectedEvaluationIndex = replyEvaluations.get(selected)
    return {
      ...reply,
      result: withFailureReferences(
        {
          ...selected.result,
          ...(selectedEvaluationIndex === undefined ? {} : { selectedEvaluationIndex }),
          cleanup: reply.result.cleanup,
          status: failures.length ? 'failed' : reply.result.status,
          durationMs: performance.now() - started,
          failures,
          evaluations,
          property: {
            source: diagnostic(input.source),
            classification: input.classification,
            seed,
            version: input.version,
            runs: input.runs,
            maxShrinks: input.maxShrinks,
            originalCounterexample,
            counterexample,
            shrinkPath,
            stopped,
          },
        },
        replyIndexes.get(selected) ?? [],
      ),
    }
  }
  for (let index = 0; index < input.runs; index++) {
    const generated = generate(input.source, random)
    random = generated.state
    let sample = arrayValue(generated.value)
    let reply = await run(sample, 'generated', index)
    if (reply.result.failures.some((failure) => failure.kind !== 'assertion' && failure.kind !== 'outcome')) {
      stopped = 'execution-failed'
      return finish(reply)
    }
    if (!active() || reply.result.status === 'cancelled') {
      stopped = 'interrupted'
      return finish(reply)
    }
    if (reply.result.status === 'failed') {
      adopted = reply
      const originalFailure = reply.result.failures.find(
        (failure) => failure.kind === 'assertion' || failure.kind === 'outcome',
      )
      originalCounterexample = diagnostic(sample)
      counterexample = originalCounterexample
      stopped = 'counterexample'
      seen.push(captureValue(sample))
      let shrinks = 0
      while (shrinks < input.maxShrinks) {
        let accepted = false
        let candidateIndex = 0
        for (const value of shrink(input.source, sample)) {
          const image = captureValue(value)
          if (seen.some((previous) => equalValues(previous, image))) {
            candidateIndex++
            continue
          }
          seen.push(image)
          if (shrinks >= input.maxShrinks) break
          shrinks++
          const candidate = arrayValue(value)
          const checked = await run(candidate, 'shrink', index)
          if (checked.result.failures.some((failure) => failure.kind !== 'assertion' && failure.kind !== 'outcome')) {
            stopped = 'execution-failed'
            return finish(checked)
          }
          if (!active() || checked.result.status === 'cancelled') {
            stopped = 'interrupted'
            return finish(checked)
          }
          const reproduces = checked.result.failures.some((failure) =>
            failure.kind === 'outcome'
              ? originalFailure?.kind === 'outcome' &&
                failure.expected === originalFailure.expected &&
                failure.operationIndex === originalFailure.operationIndex
              : failure.kind === 'assertion' &&
                originalFailure?.kind === 'assertion' &&
                failure.assertion.index === originalFailure.assertion.index &&
                failure.assertion.source === originalFailure.assertion.source,
          )
          if (checked.result.status === 'failed' && reproduces) {
            sample = candidate
            reply = checked
            adopted = checked
            counterexample = diagnostic(candidate)
            shrinkPath.push(candidateIndex)
            accepted = true
            break
          }
          candidateIndex++
        }
        if (!accepted) break
      }
      if (shrinks >= input.maxShrinks) stopped = 'max-shrinks'
      return finish(reply)
    }
    if (index + 1 === input.runs) return finish(reply)
  }
  throw new TypeError('property runs must be positive')
}
