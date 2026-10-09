import { Config, createApp } from '@zeltjs/core'
import { once } from 'node:events'
import { MessageChannel } from 'node:worker_threads'
import * as v from 'valibot'
import { expect, onTestFinished, test, vi } from 'vite-plus/test'
import { RunLifecycle } from '../../application/execution/lifecycle.js'
import { ValueComparison } from '../comparison.js'
import { ExecutionEnvironment } from './environment.js'
import { ExecutionLoader } from './execution-loader.js'
import { ExecutionServer } from './execution-server.js'
import { CompileRequests } from './execution-session.js'
import { ExecutionWorker } from './execution-worker.js'
import { executionMessageSchema } from './schemas.js'

async function wired() {
  const { port1, port2 } = new MessageChannel()
  @Config()
  class Environment extends ExecutionEnvironment {
    override readonly port = port1
  }
  const scope = await createApp([]).createRuntime({ configs: [Environment, ValueComparison, CompileRequests] })
  const loaded = vi.spyOn(await scope.get(ExecutionLoader), 'load').mockResolvedValue(new Map())
  const served = vi.spyOn(await scope.get(ExecutionServer), 'serve').mockResolvedValue()
  const lifecycle = await scope.get(RunLifecycle)
  ;(await scope.get(ExecutionWorker)).serve()
  onTestFinished(async () => {
    port1.close()
    port2.close()
    loaded.mockRestore()
    served.mockRestore()
    await scope.shutdown()
  })
  const receive = async () => {
    const inputs: unknown[] = await once(port2, 'message')
    return v.parse(executionMessageSchema, inputs[0])
  }
  return { port: port2, loaded, served, lifecycle, receive }
}

test('the worker waits for a plan, preserves an early interrupt, and rejects repeated initialization', async () => {
  const { port, loaded, served, lifecycle, receive } = await wired()
  expect(loaded).not.toHaveBeenCalled()
  port.postMessage({ type: 'interrupt' })
  const ready = receive()
  const spec = { roots: [], preparation: [], shape: '[]' }
  port.postMessage({ type: 'initialize', spec })
  expect(await ready).toStrictEqual({ type: 'ready' })
  expect(loaded).toHaveBeenCalledTimes(1)
  expect(loaded.mock.calls[0][1]).toStrictEqual(spec)
  expect(served).toHaveBeenCalledTimes(1)
  expect(lifecycle.reason).toBe('interrupted')
  const failure = receive()
  port.postMessage({ type: 'initialize', spec })
  const repeated = await failure
  expect.assert(repeated.type === 'error')
  expect(repeated.message).toContain('already initialized')
  expect(loaded).toHaveBeenCalledTimes(1)
})

test('commands before initialization fail without loading test modules', async () => {
  const { port, loaded, receive } = await wired()
  const failure = receive()
  port.postMessage({ type: 'attempt', id: 0, path: [0, 0], number: 1 })
  const uninitialized = await failure
  expect.assert(uninitialized.type === 'error')
  expect(uninitialized.message).toContain('not initialized')
  expect(loaded).not.toHaveBeenCalled()
})
