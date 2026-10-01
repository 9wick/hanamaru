import { expect, test } from 'vite-plus/test'
import { Test, middleware } from '../../index.js'
import * as comparison from '../../infrastructure/comparison.js'
import { ProgressStore } from './progress.js'

import type { MutableRunResult } from '../../domain/result/mutable.js'
import { collectBlueprints } from '../../interfaces/library/run.js'
import { createPlan } from './plan.js'
import { runPlan } from './runner.js'

test('progress transfer grows linearly and reconstructs nested case results', async () => {
  async function measure(count: number) {
    const store = new ProgressStore()
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
    const plan = createPlan(collectBlueprints(root))
    const result = await runPlan(
      plan,
      {},
      {
        comparison,
        listeners: {
          onProgress(progress) {
            bytes += JSON.stringify(progress).length
            store.apply(structuredClone(progress))
          },
          onDeadline(deadline) {
            bytes += JSON.stringify(deadline).length
          },
        },
      },
    )
    expect(store.result?.tests).toEqual(result.tests)
    return bytes
  }
  const small = await measure(50)
  const large = await measure(100)
  expect(large).toBeLessThan(small * 2.3)
})

test('the progress stream reconstructs nested groups, skips and retries', async () => {
  const store = new ProgressStore()
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
  const result = await runPlan(
    createPlan(collectBlueprints(root)),
    {},
    {
      comparison,
      listeners: { onProgress: (progress) => store.apply(structuredClone(progress)) },
    },
  )
  expect(result.status).toBe('passed')
  expect(store.result?.tests).toStrictEqual(result.tests)
})

test('the progress stream reconstructs the cancelled tree after an interrupt', async () => {
  const controller = new AbortController()
  const store = new ProgressStore()
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
  const result = await runPlan(
    createPlan(collectBlueprints([root, pending])),
    {},
    {
      comparison,
      signal: controller.signal,
      listeners: { onProgress: (progress) => store.apply(structuredClone(progress)) },
    },
  )
  expect(result.reason).toBe('interrupted')
  expect(store.result?.tests).toStrictEqual(result.tests)
})

test('progress rejects unknown paths and recomputes failure state after retry recovery', () => {
  const store = new ProgressStore()
  expect(() => store.apply({ kind: 'group', path: [0], middleware: null })).toThrow('before initialization')
  const initial: MutableRunResult = {
    version: 1,
    status: 'cancelled',
    reason: 'interrupted',
    tests: [
      {
        kind: 'test',
        name: 'test',
        path: [0],
        cases: [
          {
            name: 'case',
            origin: { file: 'test.ts', line: 1, column: 1 },
            path: [0, 0],
            row: null,
            config: { timeout: 5000, retry: 1 },
            durationMs: 0,
            attempts: [],
            notRun: 'cancelled',
          },
        ],
      },
    ],
  }
  store.apply({ kind: 'init', result: initial })
  expect(() => store.apply({ kind: 'group', path: [99], middleware: null })).toThrow('unknown group')
  const node = initial.tests[0]
  expect.assert(node.kind === 'test')
  const { notRun: _notRun, ...base } = node.cases[0]
  store.apply({
    kind: 'case',
    result: {
      ...base,
      attempts: [
        {
          attempt: 1,
          status: 'failed',
          durationMs: 1,
          outcome: null,
          assertions: [],
          failures: [],
          cleanup: 'complete',
        },
      ],
    },
  })
  expect(store.result?.status).toBe('failed')
  store.apply({
    kind: 'case',
    result: {
      ...base,
      attempts: [
        {
          attempt: 2,
          status: 'passed',
          durationMs: 1,
          outcome: null,
          assertions: [],
          failures: [],
          cleanup: 'complete',
        },
      ],
    },
  })
  expect(store.result?.status).toBe('cancelled')
})
