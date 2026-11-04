import { createTestTarget } from '@zeltjs/testing/vitest'
import { expect, test } from 'vite-plus/test'
import type { MutableAttempt } from '../../domain/result/mutable.js'
import { RunLifecycle } from './lifecycle.js'

function snapshot(): MutableAttempt {
  const input = { kind: 'number', value: 5 } as const
  const failure = {
    kind: 'assertion',
    phase: 'assert',
    message: 'negative',
    assertion: { source: 'expect', index: 0, subject: 'property', matcher: 'satisfies' },
    expected: { kind: 'string', value: 'negative' },
    actual: input,
  } as const
  return {
    attempt: 1,
    status: 'failed',
    durationMs: 1,
    outcome: null,
    assertions: [],
    failures: [failure],
    cleanup: 'incomplete',
    property: {
      source: { kind: 'undefined' },
      classification: 'generated',
      seed: 4,
      version: 1,
      runs: 10,
      maxShrinks: 20,
      originalCounterexample: input,
      counterexample: input,
      shrinkPath: [],
      stopped: 'counterexample',
    },
    evaluations: [
      {
        kind: 'generated',
        sampleIndex: 0,
        input,
        operations: [],
        expectedTermination: 'return',
        terminationTarget: null,
        status: 'failed',
        outcome: null,
        assertions: [
          {
            failureIndexes: [0],
            assertion: failure.assertion,
            status: 'failed',
            expected: failure.expected,
            actual: failure.actual,
          },
        ],
        failureIndexes: [0],
        cleanup: 'complete',
      },
    ],
  }
}
test('attempt deltas preserve completed evidence and add timeout only to the unfinished evaluation', async () => {
  const { target: lifecycle } = await createTestTarget(RunLifecycle)
  lifecycle.begin({
    kind: 'attempt',
    base: {
      name: 'property',
      caseKind: 'property',
      characteristic: 'pure',
      origin: { file: '/case.ts', line: 1, column: 1 },
      path: [0, 0],
      row: null,
      config: { timeout: 100, retry: 0 },
    },
    number: 1,
    attempts: [],
    started: performance.now(),
    timeoutMs: 100,
  })
  const original = snapshot()
  lifecycle.updateAttempt(original, 'cleanup', 0, 0)
  const pending: MutableAttempt = {
    ...original,
    failures: [],
    evaluations: [
      {
        kind: 'shrink',
        sampleIndex: 0,
        input: { kind: 'number', value: 0 },
        operations: [
          {
            failureIndexes: [],
            index: 0,
            key: 'target',
            mode: 'return-required',
            status: 'incomplete',
            args: [],
            reason: 'target pending',
          },
        ],
        expectedTermination: 'return',
        terminationTarget: null,
        status: 'cancelled',
        outcome: null,
        assertions: [
          {
            failureIndexes: [],
            pending: true,
            assertion: { source: 'expect', index: 0, subject: 'result', matcher: 'toEqual' },
            status: 'not-evaluated',
            reason: 'target pending',
          },
          {
            failureIndexes: [],
            assertion: { source: 'expect', index: 1, subject: 'error', matcher: 'toEqual' },
            status: 'not-evaluated',
            reason: 'target returned instead of throwing',
          },
        ],
        failureIndexes: [],
        cleanup: 'incomplete',
      },
    ],
  }
  lifecycle.updateAttempt(pending, 'target', 1, 1)
  lifecycle.timedOut()
  lifecycle.markPhase('cleanup')
  const progress = lifecycle.activeProgress('timeout')
  expect.assert(progress.kind === 'case')
  const attempt = progress.result.attempts[0]
  expect(attempt.failures.map((failure) => failure.kind)).toEqual(['assertion', 'timeout'])
  expect(attempt.failures[1]?.phase).toBe('target')
  expect(attempt.evaluations?.map((evaluation) => evaluation.failureIndexes)).toEqual([[0], [1]])
  expect(attempt.evaluations?.map((evaluation) => evaluation.assertions[0].failureIndexes)).toEqual([[0], [1]])
  expect(attempt.evaluations?.[1].operations[0].failureIndexes).toEqual([1])
  expect(attempt.evaluations?.[1].assertions[1]).toMatchObject({
    reason: 'target returned instead of throwing',
    failureIndexes: [],
  })
  expect(attempt.property?.counterexample).toEqual({ kind: 'number', value: 5 })
  expect(pending.evaluations?.[0]?.status).toBe('cancelled')
  expect(() => lifecycle.updateAttempt(pending, 'target', 99, 0)).toThrow('offsets')
})
