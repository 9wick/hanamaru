import { once } from 'node:events'
import { MessageChannel } from 'node:worker_threads'
import { expect, onTestFinished, test, vi } from 'vite-plus/test'
import { CollectionChannel } from './collection-channel.js'
import { CollectionEnvironment } from './environment.js'

function channel() {
  const control = new MessageChannel()
  const execution = new MessageChannel()
  class Environment extends CollectionEnvironment {
    readonly port = control.port1
    readonly executionPort = execution.port1
  }
  onTestFinished(() => {
    control.port1.close()
    control.port2.close()
    execution.port1.close()
    execution.port2.close()
  })
  return { channel: new CollectionChannel(new Environment()), parent: control.port2 }
}

test('close waits for the parent to stop execution and sends only one request', async () => {
  const { channel: worker, parent } = channel()
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
  const { channel: worker, parent } = channel()
  const closing = worker.closeExecution()
  const rejected = expect(closing).rejects.toThrow('CLI disconnected')
  parent.close()
  await rejected
})
