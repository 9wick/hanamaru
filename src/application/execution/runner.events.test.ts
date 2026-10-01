import { expect, test } from 'vite-plus/test'
import type { MutableRunResult } from '../../domain/result/mutable.js'
import type { RunOptions } from '../../index.js'
import { Test, middleware, run } from '../../index.js'
import type { Deadline, InternalRunOptions, Progress } from './state.js'

// 進捗・期限・タイムアウトの通知は公開RunOptionsにない内部オプション。
const internalOptions = (options: InternalRunOptions): RunOptions => options

function caseProgress(progress: Progress) {
  expect.assert(progress.kind === 'case')
  return progress.result
}

function groupProgress(progress: Progress) {
  expect.assert(progress.kind === 'group')
  return progress.middleware
}

function startedDeadline(deadline: Deadline) {
  expect.assert(deadline.kind === 'start')
  return deadline
}

function timedOutCase(snapshot: MutableRunResult) {
  const node = snapshot.tests[0]
  expect.assert(node?.kind === 'test')
  const attempt = node.cases[0]?.attempts[0]
  expect.assert(attempt !== undefined)
  return attempt
}

test('each attempt announces the cancelled view before it runs', async () => {
  const progress: Progress[] = []
  const suite = new Test().target(() => 1).it('case', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  await run(suite, internalOptions({ onProgress: (value) => progress.push(structuredClone(value)) }))
  expect(progress.map((value) => value.kind)).toStrictEqual(['init', 'case', 'case'])
  const announced = caseProgress(progress[1])
  expect(announced.path).toStrictEqual([0, 0])
  expect(announced.attempts.length).toBe(1)
  expect(announced.attempts[0]?.status).toBe('cancelled')
  expect(announced.attempts[0]?.cleanup).toBe('incomplete')
  expect(announced.attempts[0]?.failures).toStrictEqual([])
  const completed = caseProgress(progress[2])
  expect(completed.attempts[0]?.status).toBe('passed')
})

test('each group announces its middleware once its children are done', async () => {
  const progress: Progress[] = []
  const child = new Test().target((n: number) => n).it('leaf', (t) => t.args(1).expect((e) => [e.result.toBe(1)]))
  const inner = new Test().group(
    'inner',
    middleware(async (_, next) => next()),
    [child],
  )
  const root = new Test().group('root', [inner])
  await run(root, internalOptions({ onProgress: (value) => progress.push(structuredClone(value)) }))
  expect(progress.map((value) => value.kind)).toStrictEqual(['init', 'case', 'case', 'group', 'group'])
  const groups = progress.filter((value) => value.kind === 'group')
  // 子から親の順に、middlewareを持たないgroupもnullとして通知する。
  expect(groups.map((value) => value.path)).toStrictEqual([[0, 0], [0]])
  expect(groups.map((value) => value.middleware?.status ?? null)).toStrictEqual(['passed', null])
})

test('a timeout snapshot keeps the results finished before it', async () => {
  const snapshots: MutableRunResult[] = []
  const cases = new Test()
    .timeout(20)
    .target(async (n: number) => {
      if (n === 2) await new Promise<void>((resolve) => setTimeout(resolve, 80))
      return n
    })
    .it('fast', (t) => t.args(1).expect((e) => [e.result.toBe(1)]))
    .it('slow', (t) => t.args(2).expect((e) => [e.result.toBe(2)]))
    .todo('later')
  const root = new Test().group(
    'root',
    middleware(async (_, next) => next()),
    [cases],
  )
  const result = await run(root, internalOptions({ onTimeout: (value) => snapshots.push(structuredClone(value)) }))
  expect(result.reason).toBe('timeout')
  expect(snapshots.length).toBe(1)
  const node = snapshots[0]?.tests[0]
  expect.assert(node?.kind === 'group')
  // 打ち切り時点ではgroupはまだ終わっていないため、初期ツリーのままになる。
  expect(node.middleware?.status).toBe('not-run')
  const child = node.children[0]?.result
  expect.assert(child?.kind === 'test')
  expect(child.cases.map((item) => item.attempts[0]?.status ?? null)).toStrictEqual(['passed', 'failed', null])
  expect(child.cases.map((item) => item.notRun ?? null)).toStrictEqual([null, null, 'todo'])
  expect(child.cases[1]?.attempts[0]?.failures[0]?.kind).toBe('timeout')
})

test('an attempt timeout reports the phase it reached', async () => {
  const deadlines: Deadline[] = []
  const snapshots: MutableRunResult[] = []
  const suite = new Test()
    .timeout(10)
    .target(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 60))
      return 1
    })
    .it('slow', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  const result = await run(
    suite,
    internalOptions({
      onDeadline: (value) => deadlines.push(structuredClone(value)),
      onTimeout: (value) => snapshots.push(structuredClone(value)),
    }),
  )
  expect(result.reason).toBe('timeout')
  expect(deadlines.map((value) => value.kind)).toStrictEqual(['start', 'end'])
  const started = startedDeadline(deadlines[0])
  expect(started.timeoutMs).toBe(10)
  // 期限の通知時点ではまだmiddlewareしか進んでいない。
  expect(caseProgress(started.progress).attempts[0]?.failures[0]?.phase).toBe('middleware')
  expect(snapshots.length).toBe(1)
  expect(snapshots[0]?.status).toBe('failed')
  expect(snapshots[0]?.reason).toBe('timeout')
  const attempt = timedOutCase(snapshots[0])
  expect(attempt.status).toBe('failed')
  expect(attempt.cleanup).toBe('incomplete')
  const failure = attempt.failures[0]
  expect.assert(failure?.kind === 'timeout')
  expect(failure.phase).toBe('target')
  expect(failure.timeoutMs).toBe(10)
})

test('a group middleware timeout reports the stage it reached', async () => {
  const deadlines: Deadline[] = []
  const snapshots: MutableRunResult[] = []
  const slow = middleware(
    async (_, next) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 60))
      return next()
    },
    { timeout: 10 },
  )
  const child = new Test().target(() => 1).it('child', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  const group = new Test().group(slow, [child])
  const result = await run(
    group,
    internalOptions({
      onDeadline: (value) => deadlines.push(structuredClone(value)),
      onTimeout: (value) => snapshots.push(structuredClone(value)),
    }),
  )
  expect(result.reason).toBe('timeout')
  expect(deadlines.map((value) => value.kind)).toStrictEqual(['start', 'end'])
  const started = startedDeadline(deadlines[0])
  expect(started.timeoutMs).toBe(10)
  const announced = groupProgress(started.progress)
  expect(announced?.status).toBe('failed')
  expect(announced?.failures[0]?.phase).toBe('before')
  expect(snapshots.length).toBe(1)
  const node = snapshots[0]?.tests[0]
  expect.assert(node?.kind === 'group')
  expect(node.middleware?.status).toBe('failed')
  expect(node.middleware?.failures[0]?.kind).toBe('timeout')
  expect(node.middleware?.failures[0]?.phase).toBe('before')
})

test('an interrupt cancels without reporting a timeout', async () => {
  const controller = new AbortController()
  const progress: Progress[] = []
  const snapshots: MutableRunResult[] = []
  const suite = new Test()
    .target(() => {
      controller.abort()
      return 1
    })
    .it('active', (t) => t.args().expect((e) => [e.result.toBe(1)]))
    .it('pending', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  const result = await run(
    suite,
    internalOptions({
      signal: controller.signal,
      onProgress: (value) => progress.push(structuredClone(value)),
      onTimeout: (value) => snapshots.push(structuredClone(value)),
    }),
  )
  expect(result.reason).toBe('interrupted')
  expect(snapshots).toStrictEqual([])
  expect(progress.map((value) => value.kind)).toStrictEqual(['init', 'case', 'case', 'case'])
  expect(caseProgress(progress[2]).attempts[0]?.status).toBe('cancelled')
  expect(caseProgress(progress[3]).notRun).toBe('cancelled')
})
