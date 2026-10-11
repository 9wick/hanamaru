import { createTestTarget } from '@zeltjs/testing/vitest'
import { LibraryRun } from './run.js'
import { ValueComparison } from '../../infrastructure/comparison.js'
import { LocalExecutor } from '../../infrastructure/execution/local.js'
import { expect, test } from 'vite-plus/test'
import type { RunResult } from '../../../../../src/index.js'
import { Test } from '../../../../../src/index.js'

function firstAttempt(result: RunResult) {
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  const attempt = node.cases[0].attempts[0]
  expect.assert(attempt !== undefined)
  return attempt
}

test('mock and call records use one wrapper and restore the original method', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const service = {
    read(value: number) {
      return value * 2
    },
  }
  const original = Object.getOwnPropertyDescriptor(service, 'read')
  const suite = new Test()
    .mock(service, 'read', (m) => m.returnsOnce(7).returns(8))
    .target(() => [service.read(1), service.read(2)])
    .it('sequence', (t) =>
      t
        .args()
        .expect((e) => [e.result.toEqual([7, 8])])
        .expectCalls((call) => [call(service, 'read').calledTimes(2), call(service, 'read').calledNthWith(2, 2)]),
    )
  const result = await run(suite)
  expect(result.status).toBe('passed')
  expect(Object.getOwnPropertyDescriptor(service, 'read')).toStrictEqual(original)
  expect(service.read(3)).toBe(6)
})

test('call records can observe the real method without a mock', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const service = {
    read(value: number) {
      return value * 2
    },
  }
  const suite = new Test()
    .target(() => service.read(3))
    .it('real call', (t) =>
      t
        .args()
        .expect((e) => [e.result.toBe(6)])
        .expectCalls((call) => [call(service, 'read').calledOnceWith(3)]),
    )
  expect((await run(suite)).status).toBe('passed')
  expect(service.read(3)).toBe(6)
})

test('instrumentation restores methods after assertion failure', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const service = {
    read(value: number) {
      return value * 2
    },
  }
  const original = Object.getOwnPropertyDescriptor(service, 'read')
  const suite = new Test()
    .mock(service, 'read', (m) => m.returns(7))
    .target(() => service.read(1))
    .it('fail', (t) => t.args().expect((e) => [e.result.toBe(9)]))
  expect((await run(suite)).status).toBe('failed')
  expect(Object.getOwnPropertyDescriptor(service, 'read')).toStrictEqual(original)
})

test('cleanup failure preserves the error that preceded it', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const service = { read: () => 1 }
  const suite = new Test()
    .mock(service, 'read', (m) => m.returns(2))
    .target(() => 1)
    .it('both failures', (t) =>
      t
        .argsFrom(() => {
          Object.defineProperty(service, 'read', { value: service.read, configurable: false })
          throw new Error('args failed')
        })
        .expect((e) => [e.result.toBe(1)]),
    )
  const result = await run(suite)
  const attempt = firstAttempt(result)
  expect(result.status).toBe('failed')
  expect(attempt.cleanup).toBe('incomplete')
  expect(attempt.failures.length).toBe(2)
  expect(attempt.failures[0]?.message).toMatch(/args failed/)
})

test('failed restoration of a nonconfigurable method aborts later cases without retry', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const original = () => 1
  const service: { read: () => number } = { read: original }
  Object.defineProperty(service, 'read', { value: original, writable: true, configurable: false })
  const suite = new Test()
    .retry(1)
    .target(() => {
      Object.defineProperty(service, 'read', { writable: false })
      return service.read()
    })
    .it('locks mock', (t) =>
      t
        .mock(service, 'read', (m) => m.returns(2))
        .args()
        .expect((e) => [e.result.toBe(2)]),
    )
    .it('later', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  const result = await run(suite)
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  const first = node.cases[0]
  expect(result.status).toBe('failed')
  expect(result.reason).toBe('cleanup-failed')
  expect(first.attempts.length).toBe(1)
  const attempt = firstAttempt(result)
  expect(attempt.cleanup).toBe('incomplete')
  expect(attempt.failures[0]?.phase).toBe('cleanup')
  expect(attempt.failures[0]?.message).toMatch(/restoration failed/)
  expect(node.cases[1].notRun).toBe('cancelled')
  expect(node.cases[1].attempts).toStrictEqual([])
  expect(node.cases[1].durationMs).toBe(0)
})

test('rejected mock installation fails before calling the target', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const backing: { read: () => number } = { read: () => 1 }
  Object.defineProperty(backing, 'read', { value: () => 1, writable: true, configurable: false })
  const service = new Proxy(backing, { set: () => false })
  let called = false
  const suite = new Test()
    .mock(service, 'read', (m) => m.returns(2))
    .target(() => {
      called = true
      return service.read()
    })
    .it('cannot instrument', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  const result = await run(suite)
  expect(result.status).toBe('failed')
  expect(called).toBe(false)
  expect(firstAttempt(result).failures[0]?.phase).toBe('instrumentation')
})

test('nonconfigurable writable methods can be observed and restored', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const original = (value: number) => value + 1
  const service: { read: (value: number) => number } = { read: original }
  Object.defineProperty(service, 'read', { value: original, configurable: false, writable: true })
  const suite = new Test()
    .target(() => service.read(2))
    .it('read', (t) =>
      t
        .args()
        .expect((e) => [e.result.toBe(3)])
        .expectCalls((call) => [call(service, 'read').calledOnceWith(2)]),
    )
  expect((await run(suite)).status).toBe('passed')
  expect(service.read).toBe(original)
})

test('calls made while building expectations are not part of the target call record', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const service = {
    read() {
      return 1
    },
  }
  const suite = new Test()
    .target(() => service.read())
    .it('only target calls', (t) =>
      t
        .args()
        .expect((e) => {
          service.read()
          return [e.result.toBe(1)]
        })
        .expectCalls((call) => [call(service, 'read').calledTimes(1)]),
    )
  expect((await run(suite)).status).toBe('passed')
})
