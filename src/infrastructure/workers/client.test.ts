import { randomUUID } from 'node:crypto'
import { BroadcastChannel, MessageChannel, Worker } from 'node:worker_threads'
import { expect, onTestFinished, test, vi } from 'vite-plus/test'
import * as v from 'valibot'
import { RunEvents, RunTracker } from '../../application/execution/services.js'
import type { ExecutionServices, ExecutionSpec } from '../../application/ports/executor.js'
import { WorkerExecutionLauncher } from './client.js'
import { CollectionEnvironment } from './environment.js'

class SilentEvents extends RunEvents {
  progress(): void {}
  deadline(): void {}
  timedOut(): void {}
}

/** 別threadの起動を待ち合わせ、initializeより先にworkerが動いていることを確認する。 */
function worker(source: string) {
  const channelName = randomUUID()
  const channel = new BroadcastChannel(channelName)
  const ports = new MessageChannel()
  const url = new URL(
    `data:text/javascript,${encodeURIComponent(`
    import { BroadcastChannel, parentPort, workerData } from 'node:worker_threads'
    const channel = new BroadcastChannel(${JSON.stringify(channelName)})
    if (!parentPort) throw new Error('worker thread required')
    ${source}
  `)}`,
  )
  class Environment extends CollectionEnvironment {
    readonly port = ports.port1
    readonly executionWorkerURL = url
  }
  const prepared = new WorkerExecutionLauncher(new Environment(), new RunTracker()).open()
  onTestFinished(async () => {
    await prepared.close()
    channel.close()
    ports.port1.close()
    ports.port2.close()
  })
  return { prepared, channel }
}

const spec: ExecutionSpec = { roots: [], preparation: [{ id: 'target', keys: ['identity'] }], shape: '[]' }

function services(signal = new AbortController().signal): ExecutionServices {
  return { invoke: () => Promise.resolve([]), signal, onLoading: () => {} }
}

function message(channel: BroadcastChannel): Promise<unknown> {
  return new Promise((resolve) => {
    channel.onmessage = (input) => resolve(v.parse(v.object({ data: v.unknown() }), input).data)
  })
}

test('the worker boots without a plan and initializes later through the message port', async () => {
  const { prepared, channel } = worker(`
    channel.postMessage(workerData)
    parentPort.on('message', message => {
      if (message.type === 'initialize') {
        channel.postMessage(message.spec)
        parentPort.postMessage({ type: 'compile', id: 0, name: 'getBuiltins', args: [] })
      } else if (message.type === 'compiled') parentPort.postMessage({ type: 'ready' })
    })
  `)
  expect(await message(channel)).toStrictEqual({ role: 'execution' })
  const initialized = message(channel)
  const invoke = vi.fn(() => Promise.resolve([]))
  const execution = await prepared.start(new SilentEvents(), spec, { ...services(), invoke })
  expect(await initialized).toStrictEqual(spec)
  expect(invoke).toHaveBeenCalledExactlyOnceWith('getBuiltins', [])
  await expect(prepared.start(new SilentEvents(), spec, services())).rejects.toThrow('already initialized')
  const closing = execution.close()
  expect(prepared.close()).toBe(closing)
  await closing
  await expect(prepared.start(new SilentEvents(), spec, services())).rejects.toThrow('closed')
})

test('a boot failure before initialization is retained without an unhandled rejection', async () => {
  const emitted = vi.spyOn(Worker.prototype, 'emit')
  onTestFinished(() => emitted.mockRestore())
  const { prepared } = worker("throw new Error('broken bootstrap')")
  await expect.poll(() => emitted.mock.calls.some(([event]) => event === 'exit')).toBe(true)
  await expect(prepared.start(new SilentEvents(), spec, services())).rejects.toThrow('broken bootstrap')
})

test('closing during initialization settles the waiter and terminates the worker only once', async () => {
  const terminated = vi.spyOn(Worker.prototype, 'terminate')
  onTestFinished(() => terminated.mockRestore())
  const { prepared, channel } = worker(`
    parentPort.on('message', message => {
      if (message.type === 'initialize') channel.postMessage('initializing')
    })
  `)
  const initializing = message(channel)
  const started = prepared.start(new SilentEvents(), spec, services())
  const rejected = expect(started).rejects.toThrow('closed')
  await initializing
  const closing = prepared.close()
  expect(prepared.close()).toBe(closing)
  await closing
  await rejected
  expect(terminated).toHaveBeenCalledTimes(1)
})

test('an already aborted signal reaches the worker before initialization', async () => {
  const { prepared, channel } = worker(`
    const messages = []
    parentPort.on('message', message => {
      messages.push(message.type)
      if (message.type === 'initialize') {
        channel.postMessage(messages)
        parentPort.postMessage({ type: 'ready' })
      }
    })
  `)
  const received = message(channel)
  await prepared.start(new SilentEvents(), spec, services(AbortSignal.abort()))
  expect(await received).toStrictEqual(['interrupt', 'initialize'])
})
