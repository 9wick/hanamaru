import { createTestTarget } from '@zeltjs/testing/vitest'
import { expect, test } from 'vite-plus/test'
import type {
  MutableAttempt,
  MutableCaseResult,
  MutableGroupMiddleware,
  MutableRunResult,
} from '../../domain/result/mutable.js'
import { ProgressStore } from './progress.js'

// 契約: 進捗列から部分結果を保持し、再初期化・更新・失敗判定・不正な遷移を扱う。
// fixtureは入力データ。サービスは依存を置換せず、Zeltから取得する。
function caseResult(path: number[], name = 'case'): MutableCaseResult {
  return {
    name,
    origin: { file: 'test.ts', line: 1, column: 1 },
    path,
    row: null,
    config: { timeout: 5000, retry: 1 },
    durationMs: 0,
    attempts: [],
    notRun: 'cancelled',
  }
}

function attempt(status: 'passed' | 'failed', number = 1): MutableAttempt {
  return {
    attempt: number,
    status,
    durationMs: 1,
    outcome: { kind: 'return', value: { kind: 'number', value: 1 } },
    assertions: [],
    failures:
      status === 'failed'
        ? [{ kind: 'execution', phase: 'target', message: 'target failed', cause: { kind: 'string', value: 'failed' } }]
        : [],
    cleanup: 'complete',
  }
}

function completedCase(path: number[], attempts: MutableAttempt[]): MutableCaseResult {
  const { notRun: _notRun, ...base } = caseResult(path)
  return { ...base, durationMs: attempts.length, attempts }
}

function partialResult(): MutableRunResult {
  return {
    version: 1,
    status: 'cancelled',
    reason: 'interrupted',
    tests: [
      {
        kind: 'group',
        name: 'root',
        origin: { file: 'test.ts', line: 1, column: 1 },
        path: [0],
        middleware: null,
        children: [
          {
            origin: { file: 'test.ts', line: 2, column: 1 },
            result: {
              kind: 'test',
              name: 'nested',
              path: [0, 0],
              cases: [caseResult([0, 0, 0]), caseResult([0, 0, 1], 'pending')],
            },
          },
        ],
      },
    ],
  }
}

function middlewareResult(status: 'passed' | 'failed'): MutableGroupMiddleware {
  return {
    status,
    durationMs: 1,
    failures:
      status === 'failed'
        ? [
            {
              kind: 'execution',
              phase: 'before',
              message: 'middleware failed',
              cause: { kind: 'string', value: 'failed' },
            },
          ]
        : [],
    cleanup: 'complete',
  }
}

test('a new progress store has no partial result', async () => {
  const { target: store } = await createTestTarget(ProgressStore)
  expect(store.result).toBeNull()
})

test('initialization provides the complete initial partial result', async () => {
  const { target: store } = await createTestTarget(ProgressStore)
  const initial = partialResult()
  const expected = structuredClone(initial)
  store.apply({ kind: 'init', result: initial })
  expect(store.result).toStrictEqual(expected)
})

test('case and group updates retain unrelated results and the nested structure', async () => {
  const { target: store } = await createTestTarget(ProgressStore)
  const initial = partialResult()
  const completed = completedCase([0, 0, 0], [attempt('passed')])
  const middleware = middlewareResult('passed')
  const expected = partialResult()
  const group = expected.tests[0]
  expect.assert(group.kind === 'group')
  const suite = group.children[0].result
  expect.assert(suite.kind === 'test')
  suite.cases[0] = completed
  group.middleware = middleware
  store.apply({ kind: 'init', result: initial })
  store.apply({ kind: 'case', result: completed })
  store.apply({ kind: 'group', path: [0], middleware })
  expect(store.result).toStrictEqual(expected)
})

test('resource updates add new resources and replace existing resources by id', async () => {
  const { target: store } = await createTestTarget(ProgressStore)
  store.apply({ kind: 'init', result: partialResult() })
  const first = { id: 1, name: 'first', scope: 'perRun' as const, middleware: middlewareResult('failed') }
  const second = { id: 2, name: 'second', scope: 'perWorker' as const, middleware: middlewareResult('passed') }
  store.apply({ kind: 'resource', result: first })
  store.apply({ kind: 'resource', result: second })
  expect(store.result?.status).toBe('failed')
  const recovered = { ...first, middleware: middlewareResult('passed') }
  store.apply({ kind: 'resource', result: recovered })
  expect(store.result).toStrictEqual({ ...partialResult(), resources: [recovered, second] })
})

test('retry recovery clears only the recovered case failure and preserves attempt history', async () => {
  const { target: store } = await createTestTarget(ProgressStore)
  store.apply({ kind: 'init', result: partialResult() })
  const failed = attempt('failed')
  store.apply({ kind: 'case', result: completedCase([0, 0, 0], [failed]) })
  store.apply({ kind: 'case', result: completedCase([0, 0, 1], [attempt('failed')]) })
  expect(store.result?.status).toBe('failed')
  const recovered = completedCase([0, 0, 0], [failed, attempt('passed', 2)])
  store.apply({ kind: 'case', result: recovered })
  expect(store.result?.status).toBe('failed')
  const group = store.result?.tests[0]
  expect.assert(group?.kind === 'group')
  const suite = group.children[0].result
  expect.assert(suite.kind === 'test')
  expect(suite.cases[0]).toStrictEqual(recovered)
  store.apply({ kind: 'case', result: completedCase([0, 0, 1], [attempt('passed')]) })
  expect(store.result?.status).toBe('cancelled')
})

test('initial case, group and resource failures participate in later failure updates', async () => {
  const { target: store } = await createTestTarget(ProgressStore)
  const initial = partialResult()
  initial.status = 'failed'
  const group = initial.tests[0]
  expect.assert(group.kind === 'group')
  group.middleware = middlewareResult('failed')
  const suite = group.children[0].result
  expect.assert(suite.kind === 'test')
  suite.cases[0] = completedCase([0, 0, 0], [attempt('failed')])
  initial.resources = [{ id: 1, name: 'resource', scope: 'perRun', middleware: middlewareResult('failed') }]
  store.apply({ kind: 'init', result: initial })
  store.apply({ kind: 'case', result: completedCase([0, 0, 0], [attempt('passed')]) })
  expect(store.result?.status).toBe('failed')
  store.apply({ kind: 'group', path: [0], middleware: middlewareResult('passed') })
  expect(store.result?.status).toBe('failed')
  store.apply({
    kind: 'resource',
    result: { id: 1, name: 'resource', scope: 'perRun', middleware: middlewareResult('passed') },
  })
  expect(store.result?.status).toBe('cancelled')
})

test('a timeout remains failed after individual results recover', async () => {
  const { target: store } = await createTestTarget(ProgressStore)
  const initial = partialResult()
  initial.status = 'failed'
  initial.reason = 'timeout'
  store.apply({ kind: 'init', result: initial })
  store.apply({ kind: 'case', result: completedCase([0, 0, 0], [attempt('passed')]) })
  expect(store.result).toMatchObject({ status: 'failed', reason: 'timeout' })
})

test('reinitialization replaces previous results, failure state and paths', async () => {
  const { target: store } = await createTestTarget(ProgressStore)
  store.apply({ kind: 'init', result: partialResult() })
  store.apply({ kind: 'case', result: completedCase([0, 0, 0], [attempt('failed')]) })
  store.apply({
    kind: 'resource',
    result: { id: 1, name: 'old', scope: 'perRun', middleware: middlewareResult('failed') },
  })
  const initial: MutableRunResult = {
    version: 1,
    status: 'cancelled',
    reason: 'interrupted',
    tests: [{ kind: 'test', name: 'new', path: [1], cases: [caseResult([1, 0])] }],
  }
  const expected = structuredClone(initial)
  store.apply({ kind: 'init', result: initial })
  expect(store.result).toStrictEqual(expected)
  expect(() => store.apply({ kind: 'case', result: completedCase([0, 0, 0], [attempt('passed')]) })).toThrow(
    'unknown case',
  )
  expect(() => store.apply({ kind: 'group', path: [0], middleware: null })).toThrow('unknown group')
  store.apply({ kind: 'case', result: completedCase([1, 0], [attempt('passed')]) })
  expect(store.result?.status).toBe('cancelled')
  expect(store.result?.resources).toBeUndefined()
})

test('updates before initialization and unknown paths are rejected without changing the result', async () => {
  const { target: store } = await createTestTarget(ProgressStore)
  const completed = completedCase([0, 0, 0], [attempt('passed')])
  expect(() => store.apply({ kind: 'case', result: completed })).toThrow('before initialization')
  expect(() => store.apply({ kind: 'group', path: [0], middleware: null })).toThrow('before initialization')
  expect(() =>
    store.apply({
      kind: 'resource',
      result: { id: 1, name: 'resource', scope: 'perRun', middleware: middlewareResult('passed') },
    }),
  ).toThrow('before initialization')
  expect(store.result).toBeNull()
  const initial = partialResult()
  const expected = structuredClone(initial)
  store.apply({ kind: 'init', result: initial })
  expect(() => store.apply({ kind: 'case', result: completedCase([99, 0], [attempt('passed')]) })).toThrow(
    'unknown case',
  )
  expect(() => store.apply({ kind: 'group', path: [99], middleware: null })).toThrow('unknown group')
  expect(store.result).toStrictEqual(expected)
})

test('independent stores reconstruct the same input sequence without sharing state', async () => {
  const { target: first } = await createTestTarget(ProgressStore)
  const { target: second } = await createTestTarget(ProgressStore)
  const completed = completedCase([0, 0, 0], [attempt('passed')])
  first.apply({ kind: 'init', result: partialResult() })
  second.apply({ kind: 'init', result: partialResult() })
  first.apply({ kind: 'case', result: structuredClone(completed) })
  expect(second.result).toStrictEqual(partialResult())
  second.apply({ kind: 'case', result: structuredClone(completed) })
  const expected = partialResult()
  const group = expected.tests[0]
  expect.assert(group.kind === 'group')
  const suite = group.children[0].result
  expect.assert(suite.kind === 'test')
  suite.cases[0] = completed
  expect(first.result).toStrictEqual(expected)
  expect(second.result).toStrictEqual(expected)
})
