import { createTestTarget } from '@zeltjs/testing/vitest'
import { expect, test } from 'vite-plus/test'
import { Test, resource } from '../../index.js'
import { ValueComparison } from '../../infrastructure/comparison.js'
import { LocalExecutor } from '../../infrastructure/execution/local.js'
import { collectBlueprints } from '../../interfaces/library/run.js'
import { RunTests } from './run-tests.js'

// 契約: 共有された実物のサービス構成を使い、各runの状態と資源の寿命を分ける。
test('the same use case starts a fresh run after cancellation and releases resources after execution', async () => {
  const { target: tests } = await createTestTarget(RunTests, { configs: [ValueComparison, LocalExecutor] })
  const flow: string[] = []
  const fixture = resource({
    name: 'fixture',
    scope: 'perRun',
    setup: async (_, next) => {
      flow.push('prepare')
      try {
        return await next({ seed: 3 })
      } finally {
        flow.push('release')
      }
    },
  })
  const suite = new Test()
    .require(fixture)
    .target((n: number) => {
      flow.push('target')
      return n
    })
    .it('uses fixture', (t) => t.argsFrom((ctx) => [ctx.seed]).expect((e) => [e.result.toBe(3)]))
  const definitions = collectBlueprints(suite).map((blueprint) => ({ blueprint: () => blueprint }))
  const cancelled = await tests.execute(definitions, {}, AbortSignal.abort())
  expect(cancelled.status).toBe('cancelled')
  expect(flow).toEqual([])
  const completed = await tests.execute(definitions, {})
  expect(completed.status).toBe('passed')
  expect(completed.reason).toBe('completed')
  expect(flow).toEqual(['prepare', 'target', 'release'])
  const again = await tests.execute(definitions, {})
  expect(again.status).toBe('passed')
  expect(again.resources).toHaveLength(1)
  expect(flow).toEqual(['prepare', 'target', 'release', 'prepare', 'target', 'release'])
  expect(cancelled.resources?.[0].middleware.status).toBe('not-run')
})
