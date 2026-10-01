import { expect, test } from 'vite-plus/test'
import type { Value } from '../../foundation/value.js'
import * as comparison from '../comparison.js'
import { CommandQueue, CompileRequests, ExecutionSession } from './execution-session.js'
import type { ExecutionCommand, ExecutionMessage } from './protocol.js'

function attempt(id: number): ExecutionCommand {
  return { type: 'attempt', id, path: [0, 0], number: 1 }
}

test('compile requests number their asks and resolve the matching reply', async () => {
  const asked: { id: number; name: string; args: Value[] }[] = []
  const compiles = new CompileRequests((request) => asked.push(request))
  const first = compiles.request('fetchModule', ['a'])
  const second = compiles.request('fetchModule', ['b'])
  expect(asked).toStrictEqual([
    { id: 0, name: 'fetchModule', args: ['a'] },
    { id: 1, name: 'fetchModule', args: ['b'] },
  ])
  expect(compiles.settle({ id: 1, result: 'second' })).toBe(true)
  expect(compiles.settle({ id: 0, result: 'first' })).toBe(true)
  expect(await first).toBe('first')
  expect(await second).toBe('second')
})

test('a compile reply carrying an error rejects the request with that message', async () => {
  const compiles = new CompileRequests(() => {})
  const request = compiles.request('fetchModule', [])
  expect(compiles.settle({ id: 0, error: 'transform failed' })).toBe(true)
  await expect(request).rejects.toThrow(/transform failed/)
})

test('a reply for an unknown or already settled request is reported as unmatched', async () => {
  const compiles = new CompileRequests(() => {})
  const request = compiles.request('fetchModule', [])
  expect(compiles.settle({ id: 7 })).toBe(false)
  expect(compiles.settle({ id: 0, result: 1 })).toBe(true)
  expect(compiles.settle({ id: 0, result: 1 })).toBe(false)
  expect(await request).toBe(1)
})

test('queued commands come out in arrival order', async () => {
  const commands = new CommandQueue()
  commands.push(attempt(0))
  commands.push(attempt(1))
  expect((await commands.take()).id).toBe(0)
  expect((await commands.take()).id).toBe(1)
})

test('a command that arrives after the taker hands it over directly', async () => {
  const commands = new CommandQueue()
  const taken = commands.take()
  commands.push(attempt(3))
  expect((await taken).id).toBe(3)
  commands.push(attempt(4))
  expect((await commands.take()).id).toBe(4)
})

test('the session reports a timeout with the phase its tracker last marked', () => {
  const sent: ExecutionMessage[] = []
  const session = new ExecutionSession((message) => sent.push(message), comparison)
  session.events.timedOut()
  session.tracker.markPhase('target')
  session.events.timedOut()
  expect(sent).toStrictEqual([
    { type: 'timeout', phase: undefined },
    { type: 'timeout', phase: 'target' },
  ])
})

test('the session hands its tracker and events to the attempt services', () => {
  const session = new ExecutionSession(() => {}, comparison)
  expect(session.services.tracker).toBe(session.tracker)
  expect(session.services.events).toBe(session.events)
  expect(session.services.comparison).toBe(comparison)
})

test('the session asks for compilation through the worker protocol', () => {
  const sent: ExecutionMessage[] = []
  const session = new ExecutionSession((message) => sent.push(message), comparison)
  void session.compiles.request('getBuiltins', [])
  expect(sent).toStrictEqual([{ type: 'compile', id: 0, name: 'getBuiltins', args: [] }])
})
