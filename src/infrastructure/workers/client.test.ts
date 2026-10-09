import { Config } from '@zeltjs/core'
import { createTestTarget } from '@zeltjs/testing/vitest'
import { randomUUID } from 'node:crypto'
import { BroadcastChannel, MessageChannel, Worker } from 'node:worker_threads'
import { expect, onTestFinished, test, vi } from 'vite-plus/test'
import * as v from 'valibot'
import type { ExecutionServices, ExecutionSpec } from '../../application/ports/executor.js'
import { WorkerExecutionLauncher } from './client.js'
import { CollectionEnvironment } from './environment.js'
import { CollectionChannel } from './collection-channel.js'

/** 別threadの起動を待ち合わせ、initializeより先にworkerが動いていることを確認する。 */
async function worker(source: string) {
  const channelName = randomUUID()
  const channel = new BroadcastChannel(channelName)
  const ports = new MessageChannel()
  const executionPorts = new MessageChannel()
  const url = new URL(
    `data:text/javascript,${encodeURIComponent(`
    import { BroadcastChannel, parentPort, workerData } from 'node:worker_threads'
    const channel = new BroadcastChannel(${JSON.stringify(channelName)})
    if (!parentPort) throw new Error('worker thread required')
    const port = workerData.port
    ${source}
  `)}`,
  )
  @Config()
  class Environment extends CollectionEnvironment {
    readonly port = ports.port1
    readonly executionPort = executionPorts.port1
  }
  const remote = new Worker(url, {
    workerData: { role: 'execution', port: executionPorts.port2 },
    transferList: [executionPorts.port2],
  })
  const failed = vi.fn<(error: Error) => void>()
  remote.on('error', failed)
  let stopping: Promise<void> | undefined
  const stop = () => (stopping ??= remote.terminate().then(() => {}))
  @Config()
  class Channel extends CollectionChannel {
    override closeExecution(): Promise<void> {
      return stop()
    }
  }
  onTestFinished(async () => {
    try {
      await stop()
    } finally {
      channel.close()
      ports.port1.close()
      ports.port2.close()
      executionPorts.port1.close()
    }
  })
  const { target: launcher } = await createTestTarget(WorkerExecutionLauncher, {
    configs: [Environment, Channel, WorkerExecutionLauncher],
  })
  const prepared = launcher.open()
  onTestFinished(async () => {
    await prepared.close()
  })
  return { prepared, channel, failed }
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
  const { prepared, channel } = await worker(`
    channel.postMessage({ role: workerData.role })
    port.on('message', message => {
      if (message.type === 'initialize') {
        channel.postMessage(message.spec)
        port.postMessage({ type: 'compile', id: 0, name: 'getBuiltins', args: [] })
      } else if (message.type === 'compiled') port.postMessage({ type: 'ready' })
    })
  `)
  expect(await message(channel)).toStrictEqual({ role: 'execution' })
  const initialized = message(channel)
  const invoke = vi.fn(() => Promise.resolve([]))
  const execution = await prepared.start(spec, { ...services(), invoke })
  expect(await initialized).toStrictEqual(spec)
  expect(invoke).toHaveBeenCalledExactlyOnceWith('getBuiltins', [])
  await expect(prepared.start(spec, services())).rejects.toThrow('already initialized')
  const closing = execution.close()
  expect(prepared.close()).toBe(closing)
  await closing
  await expect(prepared.start(spec, services())).rejects.toThrow('closed')
})

test('a boot failure before initialization is retained without an unhandled rejection', async () => {
  const emitted = vi.spyOn(Worker.prototype, 'emit')
  onTestFinished(() => emitted.mockRestore())
  const { prepared, failed } = await worker("throw new Error('broken bootstrap')")
  await expect.poll(() => emitted.mock.calls.some(([event]) => event === 'exit')).toBe(true)
  expect(failed.mock.calls[0][0].message).toBe('broken bootstrap')
  await expect(prepared.start(spec, services())).rejects.toThrow('disconnected')
})

test('closing during initialization settles the waiter and terminates the worker only once', async () => {
  const terminated = vi.spyOn(Worker.prototype, 'terminate')
  onTestFinished(() => terminated.mockRestore())
  const { prepared, channel } = await worker(`
    port.on('message', message => {
      if (message.type === 'initialize') channel.postMessage('initializing')
    })
  `)
  const initializing = message(channel)
  const started = prepared.start(spec, services())
  const rejected = expect(started).rejects.toThrow('closed')
  await initializing
  const closing = prepared.close()
  expect(prepared.close()).toBe(closing)
  await closing
  await rejected
  expect(terminated).toHaveBeenCalledTimes(1)
})

test('an already aborted signal reaches the worker before initialization', async () => {
  const { prepared, channel } = await worker(`
    const messages = []
    port.on('message', message => {
      messages.push(message.type)
      if (message.type === 'initialize') {
        channel.postMessage(messages)
        port.postMessage({ type: 'ready' })
      }
    })
  `)
  const received = message(channel)
  await prepared.start(spec, services(AbortSignal.abort()))
  expect(await received).toStrictEqual(['interrupt', 'initialize'])
})
