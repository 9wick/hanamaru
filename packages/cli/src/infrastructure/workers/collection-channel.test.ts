import { createTestTarget } from '@zeltjs/testing/vitest'
import { once } from 'node:events'
import { MessageChannel } from 'node:worker_threads'
import { expect, onTestFinished, test, vi } from 'vite-plus/test'
import { CollectionChannel } from './collection-channel.js'

async function channel() {
  const control = new MessageChannel()
  const execution = new MessageChannel()
  onTestFinished(() => {
    control.port1.close()
    control.port2.close()
    execution.port1.close()
    execution.port2.close()
  })
  const { target: channel } = await createTestTarget(CollectionChannel)
  channel.connect(control.port1)
  return { channel, parent: control.port2 }
}

test('sending before connection reports the missing startup resource', async () => {
  const { target } = await createTestTarget(CollectionChannel)
  expect(() => target.post({ type: 'error', message: 'failure' })).toThrow('collection channel is not connected')
})

test('a second connection is rejected and the original parent remains connected', async () => {
  const { channel: worker, parent } = await channel()
  const replacement = new MessageChannel()
  onTestFinished(() => {
    replacement.port1.close()
    replacement.port2.close()
  })
  expect(() => worker.connect(replacement.port1)).toThrow('collection channel is already connected')
  const received = once(parent, 'message')
  worker.post({ type: 'error', message: 'original connection' })
  await expect(received).resolves.toStrictEqual([{ type: 'error', message: 'original connection' }])
})

test('close waits for the parent to stop execution and sends only one request', async () => {
  const { channel: worker, parent } = await channel()
  const requested = once(parent, 'message')
  const stopped = vi.fn()
  const closing = worker.closeExecution()
  expect(worker.closeExecution()).toBe(closing)
  await expect(requested).resolves.toStrictEqual([{ type: 'close-execution' }])
  const settled = closing.then(stopped)
  expect(stopped).not.toHaveBeenCalled()
  const interrupted = vi.fn()
  worker.onInterrupt(interrupted)
  parent.postMessage({ type: 'interrupt' })
  await expect.poll(() => interrupted.mock.calls.length).toBe(1)
  expect(stopped).not.toHaveBeenCalled()
  parent.postMessage({ type: 'execution-closed' })
  await settled
  expect(stopped).toHaveBeenCalledTimes(1)
})

test('disconnecting the parent rejects the execution shutdown waiter', async () => {
  const { channel: worker, parent } = await channel()
  const closing = worker.closeExecution()
  const rejected = expect(closing).rejects.toThrow('CLI disconnected')
  parent.close()
  await rejected
})
