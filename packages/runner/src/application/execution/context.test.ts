import { createTestTarget } from '@zeltjs/testing/vitest'
import { expect, test } from 'vite-plus/test'
import { RunContext } from './context.js'
import { RunLifecycle } from './lifecycle.js'
import { ProgressStore } from './progress.js'

// 契約: 同じサービスでも、遅れて完了する仕事は元のrunの状態と通知先を参照する。
test('late work retains its run data and observers when the services handle another run', async () => {
  const { target: context, get } = await createTestTarget(RunContext)
  const lifecycle = await get(RunLifecycle)
  const progress = await get(ProgressStore)
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const notifications: string[] = []
  const previous = context.run(async () => {
    lifecycle.publish({
      kind: 'init',
      result: { version: 1, status: 'cancelled', reason: 'interrupted', tests: [] },
    })
    lifecycle.observe((event) => notifications.push(`previous:${event.kind}`))
    await gate
    lifecycle.timedOut()
    return lifecycle.capture('timeout')
  })
  const current = context.run(() => {
    lifecycle.publish({
      kind: 'init',
      result: { version: 1, status: 'cancelled', reason: 'interrupted', tests: [] },
    })
    lifecycle.observe((event) => notifications.push(`current:${event.kind}`))
    return progress.result
  })
  expect.assert(release !== undefined)
  release()
  expect((await previous).reason).toBe('timeout')
  expect(notifications).toStrictEqual(['previous:timeout'])
  expect(lifecycle.reason).toBeNull()
  expect(progress.result).toBe(current)
})
