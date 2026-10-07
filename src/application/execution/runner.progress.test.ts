import { createTestTarget } from '@zeltjs/testing/vitest'
import { expect, test } from 'vite-plus/test'
import { Test, middleware } from '../../index.js'
import { ValueComparison } from '../../infrastructure/comparison.js'
import { collectBlueprints } from '../../interfaces/library/run.js'
import { LocalExecutor } from './local.js'
import { createPlan } from './plan.js'
import { ProgressStore } from './progress.js'
import { RunWalker } from './runner.js'
import type { RunEvents } from './services.js'
import type { Progress } from './state.js'

// 契約: 実物の実行サービスと連携して、計画の結果を部分結果ツリーへ反映する。
// 通知先は実行ごとの出力先。本番の通信経路はCLI E2Eで検証する。

test('walker publishes proportionate progress data and retains completed nested results', async () => {
  async function measure(count: number) {
    const { target: walker, get } = await createTestTarget(RunWalker, { configs: [ValueComparison, LocalExecutor] })
    const store = await get(ProgressStore)
    const executor = await get(LocalExecutor)
    let bytes = 0
    const cases = new Test()
      .target((n: number) => n)
      .each(
        'value',
        Array.from({ length: count }, (_, i) => i),
        (t, n) => t.args(n).expect((e) => [e.result.toBe(n)]),
      )
    const root = new Test().group(
      'root',
      middleware(async (_, next) => next()),
      [cases],
    )
    const events: RunEvents = {
      progress(progress) {
        bytes += JSON.stringify(progress).length
      },
      deadline(deadline) {
        bytes += JSON.stringify(deadline).length
      },
      timedOut() {
        throw new Error('unexpected timeout')
      },
    }
    const result = await walker.run(await executor.start(events), () => createPlan(collectBlueprints(root)), {}, events)
    expect(result.status).toBe('passed')
    const group = store.result?.tests[0]
    expect.assert(group?.kind === 'group')
    const suite = group.children[0].result
    expect.assert(suite.kind === 'test')
    expect(suite.cases).toHaveLength(count)
    expect(suite.cases.every((item) => item.attempts.at(-1)?.status === 'passed')).toBe(true)
    expect(store.result?.tests).toEqual(result.tests)
    return bytes
  }
  const small = await measure(50)
  const large = await measure(100)
  expect(large).toBeLessThan(small * 2.3)
})

test('walker retains nested group, skipped and retried results in its progress store', async () => {
  const { target: walker, get } = await createTestTarget(RunWalker, { configs: [ValueComparison, LocalExecutor] })
  const store = await get(ProgressStore)
  const executor = await get(LocalExecutor)
  let attempts = 0
  const flaky = new Test()
    .retry(1)
    .target(() => ++attempts)
    .it('flaky', (t) => t.args().expect((e) => [e.result.toBe(2)]))
  const steady = new Test()
    .target((n: number) => n)
    .it('passes', (t) => t.args(1).expect((e) => [e.result.toBe(1)]))
    .skip('skipped', (t) => t.args(2).expect((e) => [e.result.toBe(2)]))
    .todo('todo')
  const inner = new Test().group(
    'inner',
    middleware(async (_, next) => next()),
    [flaky],
  )
  const root = new Test().group('root', [inner, steady])
  const notifications: Progress[] = []
  let deadlines = 0
  const events: RunEvents = {
    progress(value) {
      notifications.push(structuredClone(value))
    },
    deadline() {
      deadlines++
    },
    timedOut() {
      throw new Error('unexpected timeout')
    },
  }
  const result = await walker.run(await executor.start(events), () => createPlan(collectBlueprints(root)), {}, events)
  expect(result.status).toBe('passed')
  const group = store.result?.tests[0]
  expect.assert(group?.kind === 'group')
  const innerGroup = group.children[0].result
  expect.assert(innerGroup.kind === 'group')
  const retried = innerGroup.children[0].result
  expect.assert(retried.kind === 'test')
  expect(retried.cases[0].attempts.map((attempt) => attempt.status)).toStrictEqual(['failed', 'passed'])
  expect(innerGroup.middleware?.status).toBe('passed')
  const steadyResult = group.children[1].result
  expect.assert(steadyResult.kind === 'test')
  expect(steadyResult.cases[0].attempts[0].status).toBe('passed')
  expect(steadyResult.cases.slice(1).map((item) => item.notRun)).toStrictEqual(['skipped', 'todo'])
  expect(store.result?.tests).toStrictEqual(result.tests)
  expect(notifications[0].kind).toBe('init')
  expect(notifications.filter((value) => value.kind === 'group').map((value) => value.path)).toStrictEqual([
    [0, 0],
    [0],
  ])
  expect(deadlines).toBeGreaterThan(0)
})

test('walker retains the interrupted tree and leaves pending cases unexecuted', async () => {
  const controller = new AbortController()
  const { target: walker, get } = await createTestTarget(RunWalker, { configs: [ValueComparison, LocalExecutor] })
  const store = await get(ProgressStore)
  const executor = await get(LocalExecutor)
  const active = new Test()
    .target(() => {
      controller.abort()
      return 1
    })
    .it('active', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  const pending = new Test().target((n: number) => n).it('pending', (t) => t.args(1).expect((e) => [e.result.toBe(1)]))
  const root = new Test().group(
    'root',
    middleware(async (_, next) => next()),
    [active, pending],
  )
  const notifications: Progress[] = []
  let deadlines = 0
  const events: RunEvents = {
    progress(value) {
      notifications.push(structuredClone(value))
    },
    deadline() {
      deadlines++
    },
    timedOut() {
      throw new Error('unexpected timeout')
    },
  }
  const result = await walker.run(
    await executor.start(events),
    () => createPlan(collectBlueprints([root, pending])),
    {},
    events,
    controller.signal,
  )
  expect(result.reason).toBe('interrupted')
  expect(result.status).toBe('cancelled')
  const group = store.result?.tests[0]
  expect.assert(group?.kind === 'group')
  const pendingResult = group.children[1].result
  expect.assert(pendingResult.kind === 'test')
  expect(pendingResult.cases[0]).toMatchObject({ notRun: 'cancelled', attempts: [] })
  const pendingRoot = store.result?.tests[1]
  expect.assert(pendingRoot?.kind === 'test')
  expect(pendingRoot.cases[0]).toMatchObject({ notRun: 'cancelled', attempts: [] })
  expect(store.result?.tests).toStrictEqual(result.tests)
  expect(notifications[0].kind).toBe('init')
  expect(deadlines).toBeGreaterThan(0)
})
