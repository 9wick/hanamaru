import { createTestTarget } from '@zeltjs/testing/vitest'
import { expect, test } from 'vite-plus/test'
import { Test, resource } from '../../../../../src/index.js'
import { ValueComparison } from '../../testing/inline-execution.test.js'
import { LocalExecutor } from '../../testing/inline-execution.test.js'
import { collectBlueprints } from '../../testing/inline-execution.test.js'
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
  const cancelled = await tests.executeBlueprints(collectBlueprints(suite), {}, AbortSignal.abort(), {
    roots: [],
    timeout: 30000,
  })
  expect(cancelled.status).toBe('cancelled')
  expect(flow).toEqual([])
  const completed = await tests.executeBlueprints(collectBlueprints(suite), {}, undefined, {
    roots: [],
    timeout: 30000,
  })
  expect(completed.status).toBe('passed')
  expect(completed.reason).toBe('completed')
  expect(flow).toEqual(['prepare', 'target', 'release'])
  const again = await tests.executeBlueprints(collectBlueprints(suite), {}, undefined, { roots: [], timeout: 30000 })
  expect(again.status).toBe('passed')
  expect(again.resources).toHaveLength(1)
  expect(flow).toEqual(['prepare', 'target', 'release', 'prepare', 'target', 'release'])
  expect(cancelled.resources?.[0].middleware.status).toBe('not-run')
})
