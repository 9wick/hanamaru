import type { AssertionResult, Failure, MutableAttempt, OperationResult } from './result-types.js'

/** 各評価の失敗だけを使い、attempt内の失敗一覧への参照を構築する。 */
export function withFailureReferences(attempt: MutableAttempt, selectedIndexes?: readonly number[]): MutableAttempt {
  function link(
    assertions: readonly AssertionResult[],
    operations: readonly OperationResult[],
    indexes: readonly number[],
  ) {
    const failures = indexes.flatMap((index) => {
      const failure = attempt.failures[index]
      if (!failure) throw new TypeError('evaluation refers to a missing failure')
      return [{ index, failure }]
    })
    return {
      assertions: assertions.map((assertion) =>
        withIndexes(
          assertion,
          failures
            .filter(
              ({ failure }) =>
                ('assertion' in failure && failure.assertion?.index === assertion.assertion.index) ||
                (failure.kind === 'timeout' && assertion.status === 'not-evaluated' && assertion.pending),
            )
            .map(({ index }) => index),
        ),
      ),
      operations: operations.map((operation) =>
        withIndexes(
          operation,
          failures
            .filter(
              ({ failure }) =>
                operationIndex(failure) === operation.index ||
                (failure.kind === 'timeout' && operation.status === 'incomplete'),
            )
            .map(({ index }) => index),
        ),
      ),
    }
  }
  const evaluations = attempt.evaluations?.map((evaluation) => {
    const linked = link(evaluation.assertions, evaluation.operations, evaluation.failureIndexes)
    return linked.assertions.every((item, index) => item === evaluation.assertions[index]) &&
      linked.operations.every((item, index) => item === evaluation.operations[index])
      ? evaluation
      : { ...evaluation, ...linked }
  })
  const selected =
    attempt.selectedEvaluationIndex === undefined ? evaluations?.at(-1) : evaluations?.[attempt.selectedEvaluationIndex]
  if (attempt.selectedEvaluationIndex !== undefined && !selected)
    throw new TypeError('selected evaluation is unavailable')
  const top = link(
    attempt.assertions,
    attempt.operations ?? [],
    selectedIndexes ?? selected?.failureIndexes ?? attempt.failures.map((_, index) => index),
  )
  return { ...attempt, ...top, ...(evaluations ? { evaluations } : {}) }
}

function operationIndex(failure: Failure): number | undefined {
  if (failure.kind === 'outcome') return failure.operationIndex
  if (
    failure.kind === 'observation' &&
    failure.observation.kind === 'state' &&
    failure.observation.timing.kind === 'after-step'
  )
    return failure.observation.timing.operationIndex
  if ('assertion' in failure) return failure.assertion?.operationIndex
  return undefined
}

function withIndexes<T extends { readonly failureIndexes?: readonly number[] }>(
  item: T,
  indexes: readonly number[],
): T {
  return item.failureIndexes?.length === indexes.length &&
    item.failureIndexes.every((value, index) => value === indexes[index])
    ? item
    : { ...item, failureIndexes: indexes }
}
