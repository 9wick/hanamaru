import { createTestTarget } from '@zeltjs/testing/vitest'
import { MessageChannel } from 'node:worker_threads'
import * as v from 'valibot'
import { expect, onTestFinished, test } from 'vite-plus/test'
import { ExecutionLifecycle } from '../../application/execution/lifecycle.js'
import { ExecutionChannel } from './execution-channel.js'
import { CommandQueue, CompileRequests, ExecutionSession } from './execution-session.js'
import type { ExecutionCommand } from '@hanamaru/execution-protocol/data'
import { executionMessageSchema } from './execution-schemas.js'

test('the execution channel requires its startup connection before sending', async () => {
  const { target } = await createTestTarget(ExecutionChannel)
  expect(() => target.ready()).toThrow('execution channel is not connected')
})

test('the execution channel rejects a second connection', async () => {
  const { target } = await createTestTarget(ExecutionChannel)
  const original = new MessageChannel()
  const replacement = new MessageChannel()
  onTestFinished(() => {
    original.port1.close()
    original.port2.close()
    replacement.port1.close()
    replacement.port2.close()
  })
  target.connect(original.port1)
  expect(() => target.connect(replacement.port1)).toThrow('execution channel is already connected')
  const received = new Promise<unknown>((resolve) => original.port2.once('message', resolve))
  target.ready()
  await expect(received).resolves.toStrictEqual({ type: 'ready' })
})

function attempt(id: number): ExecutionCommand {
  return { type: 'attempt', id, path: [0, 0], number: 1 }
}

/**
 * 本物のMessagePortを通し、protocolへ出た形そのものを観察する。
 * 配送は送信と同じtickでは終わらないため、待つ件数を指定して受け取りを待ち合わせる。
 */
async function wired() {
  const { port1, port2 } = new MessageChannel()
  onTestFinished(() => {
    port1.close()
    port2.close()
  })
  const sent: v.InferOutput<typeof executionMessageSchema>[] = []
  let notify = () => {}
  port2.on('message', (message) => {
    sent.push(v.parse(executionMessageSchema, message))
    notify()
  })
  const { target: session, get } = await createTestTarget(ExecutionSession)
  ;(await get(ExecutionChannel)).connect(port1)
  return {
    session,
    get,
    sent,
    until: (count: number) =>
      new Promise<void>((resolve) => {
        notify = () => {
          if (sent.length >= count) resolve()
        }
        notify()
      }),
  }
}

test('compile requests number their asks and resolve the matching reply', async () => {
  const { get, sent, until } = await wired()
  const compiles = await get(CompileRequests)
  const first = compiles.invoke('fetchModule', ['a'])
  const second = compiles.invoke('fetchModule', ['b'])
  await until(2)
  expect(sent).toStrictEqual([
    { type: 'compile', id: 0, name: 'fetchModule', args: ['a'] },
    { type: 'compile', id: 1, name: 'fetchModule', args: ['b'] },
  ])
  expect(compiles.settle({ id: 1, result: 'second' })).toBe(true)
  expect(compiles.settle({ id: 0, result: 'first' })).toBe(true)
  expect(await first).toBe('first')
  expect(await second).toBe('second')
})

test('a compile reply carrying an error rejects the request with that message', async () => {
  const { get } = await wired()
  const compiles = await get(CompileRequests)
  const request = compiles.invoke('fetchModule', [])
  expect(compiles.settle({ id: 0, error: 'transform failed' })).toBe(true)
  await expect(request).rejects.toThrow(/transform failed/)
})

test('a reply for an unknown or already settled request is reported as unmatched', async () => {
  const { get } = await wired()
  const compiles = await get(CompileRequests)
  const request = compiles.invoke('fetchModule', [])
  expect(compiles.settle({ id: 7 })).toBe(false)
  expect(compiles.settle({ id: 0, result: 1 })).toBe(true)
  expect(compiles.settle({ id: 0, result: 1 })).toBe(false)
  expect(await request).toBe(1)
})

test('queued commands come out in arrival order', async () => {
  const { target: commands } = await createTestTarget(CommandQueue)
  commands.push(attempt(0))
  commands.push(attempt(1))
  expect((await commands.take()).id).toBe(0)
  expect((await commands.take()).id).toBe(1)
})

test('a command that arrives after the taker hands it over directly', async () => {
  const { target: commands } = await createTestTarget(CommandQueue)
  const taken = commands.take()
  commands.push(attempt(3))
  expect((await taken).id).toBe(3)
  commands.push(attempt(4))
  expect((await commands.take()).id).toBe(4)
})

test('the worker reports a timeout with the phase the run last reached', async () => {
  const { get, sent, until } = await wired()
  const lifecycle = await get(ExecutionLifecycle)
  lifecycle.timedOut()
  ;(await get(ExecutionLifecycle)).markPhase('target')
  lifecycle.timedOut()
  await until(2)
  expect(sent).toStrictEqual([
    { type: 'timeout', phase: undefined },
    { type: 'timeout', phase: 'target' },
  ])
})

test('the session asks for compilation through the worker protocol', async () => {
  const { get, sent, until } = await wired()
  void (await get(CompileRequests)).invoke('getBuiltins', [])
  await until(1)
  expect(sent).toStrictEqual([{ type: 'compile', id: 0, name: 'getBuiltins', args: [] }])
})

test('the session routes each incoming message to its destination', async () => {
  const { session, get } = await wired()
  expect(session.receive({ type: 'interrupt' })).toBe(true)
  expect((await get(ExecutionLifecycle)).reason).toBe('interrupted')
  expect(session.receive(attempt(5))).toBe(true)
  expect((await (await get(CommandQueue)).take()).id).toBe(5)
  // 覚えのないcompile返信だけは入口が畳み方を決めるため、見分けた結果を返す。
  expect(session.receive({ type: 'compiled', id: 9, result: 1 })).toBe(false)
})
