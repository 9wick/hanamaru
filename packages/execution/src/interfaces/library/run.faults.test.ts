import { createTestTarget } from '@zeltjs/testing/vitest'
import { LibraryRun } from './run.js'
import { ValueComparison } from '../../infrastructure/comparison.js'
import { LocalExecutor } from '../../infrastructure/execution/local.js'
import { expect, test } from 'vite-plus/test'
import type {
  AttemptResult,
  CaseResult,
  DiagnosticValue,
  Failure,
  GroupResult,
  RunResult,
  TestResult,
} from '../../../../../src/index.js'
import { Test, middleware } from '../../../../../src/index.js'

function testNode(result: RunResult, index = 0): TestResult {
  const node = result.tests[index]
  expect.assert(node.kind === 'test')
  return node
}

function groupNode(result: RunResult, index = 0): GroupResult {
  const node = result.tests[index]
  expect.assert(node.kind === 'group')
  return node
}

function attemptsOf(item: CaseResult): readonly AttemptResult[] {
  return [...item.attempts]
}

function attemptOf(item: CaseResult, index = 0): AttemptResult {
  const attempt = attemptsOf(item)[index]
  expect.assert(attempt !== undefined)
  return attempt
}

function failuresOf(attempt: AttemptResult): readonly Failure[] {
  return [...attempt.failures]
}

/** 例外の診断はプロパティの一覧なので、messageだけを取り出して契約違反の文面を確かめる。 */
function diagnosticMessage(value: DiagnosticValue): string | null {
  if (value.kind !== 'object') return null
  for (const property of value.properties)
    if (property.key.kind === 'string' && property.key.value === 'message' && property.value.kind === 'string')
      return property.value.value
  return null
}

test('a second next call is a contract failure that does not retry', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  let entries = 0
  const twice = middleware(async (_, next) => {
    entries++
    const result = await next()
    await next()
    return result
  })
  const suite = new Test()
    .retry(2)
    .use(twice)
    .target((a: number, b: number) => a + b)
    .it('twice', (t) => t.args(1, 2).expect((e) => [e.result.toBe(3)]))
  const result = await run(suite)
  expect(result.status).toBe('failed')
  expect(entries).toBe(1)
  const attempts = attemptsOf(testNode(result).cases[0])
  expect(attempts.length).toBe(1)
  const failure = failuresOf(attempts[0])[0]
  expect.assert(failure?.kind === 'execution')
  expect(failure.message).toBe('middleware contract failed')
  expect(diagnosticMessage(failure.cause)).toBe('next called more than once')
})

test('next rejects fields that are not plain objects', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const exotic = middleware(async (_, next) => next(new Map<string, number>()))
  const suite = new Test()
    .use(exotic)
    .target((a: number, b: number) => a + b)
    .it('exotic', (t) => t.args(1, 2).expect((e) => [e.result.toBe(3)]))
  const result = await run(suite)
  expect(result.status).toBe('failed')
  const failure = failuresOf(attemptOf(testNode(result).cases[0]))[0]
  expect.assert(failure?.kind === 'execution')
  expect(failure.message).toBe('middleware contract failed')
  expect(diagnosticMessage(failure.cause)).toBe('next(fields) requires a plain object')
})

test('a postprocessing error after a failed case reports both and stops retrying', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const broken = middleware(async (_, next) => {
    try {
      return await next()
    } catch {
      throw new Error('close failed')
    }
  })
  const suite = new Test()
    .retry(2)
    .use(broken)
    .target(() => 1)
    .it('wrong', (t) => t.args().expect((e) => [e.result.toBe(2)]))
  const result = await run(suite)
  expect(result.reason).toBe('cleanup-failed')
  const attempts = attemptsOf(testNode(result).cases[0])
  expect(attempts.length).toBe(1)
  expect(attempts[0].cleanup).toBe('incomplete')
  const failures = failuresOf(attempts[0])
  expect(failures.map((issue) => issue.kind)).toStrictEqual(['assertion', 'execution'])
  expect(failures[1].message).toMatch(/close failed/)
})

test('a postprocessing timeout after a passing case keeps the cleanup complete', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const slow = middleware(
    async (_, next) => {
      try {
        return await next()
      } finally {
        await new Promise<void>((resolve) => setTimeout(resolve, 50))
      }
    },
    { timeout: 10 },
  )
  const suite = new Test()
    .retry(2)
    .use(slow)
    .target(() => 1)
    .it('passes', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  const result = await run(suite)
  expect(result.reason).toBe('timeout')
  const attempts = attemptsOf(testNode(result).cases[0])
  expect(attempts.length).toBe(1)
  expect(attempts[0].cleanup).toBe('complete')
  const failure = failuresOf(attempts[0])[0]
  expect.assert(failure?.kind === 'timeout')
  expect(failure.stage).toBe('after')
  expect(failure.timeoutMs).toBe(10)
})

test('a group middleware that never calls next fails the contract and cancels children', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const child = new Test()
    .target((a: number, b: number) => a + b)
    .it('child', (t) => t.args(1, 2).expect((e) => [e.result.toBe(3)]))
  const skipped = middleware(async () => {
    throw new Error('before failed')
  })
  const result = await run(new Test().group(skipped, [child]))
  expect(result.status).toBe('failed')
  const node = groupNode(result)
  expect(node.middleware?.status).toBe('failed')
  expect(node.middleware?.cleanup).toBe('complete')
  const failure = node.middleware?.failures[0]
  expect.assert(failure?.kind === 'execution')
  expect(failure.phase).toBe('before')
  expect(diagnosticMessage(failure.cause)).toBe('before failed')
})

test('a synchronous target that outlasts the attempt times out at the phase it ended in', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const suite = new Test()
    .timeout(10)
    .target(() => {
      const deadline = performance.now() + 40
      while (performance.now() < deadline) {
        // 期限を超えるまで同期的にブロックし、タイマーの発火を待たせない。
      }
      return 1
    })
    .it('blocking', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  const result = await run(suite)
  expect(result.reason).toBe('timeout')
  const attempts = attemptsOf(testNode(result).cases[0])
  expect(attempts.length).toBe(1)
  expect(attempts[0].cleanup).toBe('complete')
  const failure = failuresOf(attempts[0])[0]
  expect.assert(failure?.kind === 'timeout')
  expect(failure.phase).toBe('cleanup')
  expect(failure.timeoutMs).toBe(10)
})
