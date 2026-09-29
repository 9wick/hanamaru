import { expect, test } from 'vite-plus/test'
import { diagnostic } from './diagnostic.js'
import { Test, middleware, run } from './index.js'
import type { RunResult } from './api.js'

function attempt(result: RunResult) {
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  const value = node.cases[0].attempts[0]
  expect.assert(value !== undefined)
  return value
}

test('inspection errors cannot turn a return into an expected throw', async () => {
  const value = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error('inspection exploded')
      },
    },
  )
  const definition = new Test()
    .target(() => value)
    .it('must throw', (t) => t.args().expect((e) => [e.error.toThrow('inspection exploded')]))
  const result = await run(definition)
  expect(result.status).toBe('failed')
  expect(attempt(result).outcome).toEqual({
    kind: 'return',
    value: { kind: 'omitted', reason: 'inspection failed: inspection exploded' },
  })
  expect(attempt(result).assertions[0].status).toBe('not-evaluated')
})

test('inspection preserves return and throw identity and never reads function name getters', async () => {
  const value = new Proxy(
    {},
    {
      ownKeys() {
        throw value
      },
    },
  )
  const returned = await run(
    new Test().target(() => value).it('return', (t) => t.args().expect((e) => [e.result.toBe(value)])),
  )
  const thrown = await run(
    new Test()
      .target(() => {
        throw value
      })
      .it('throw', (t) => t.args().expect((e) => [e.error.toSatisfy((error) => error === value)])),
  )
  expect(returned.status).toBe('passed')
  expect(thrown.status).toBe('passed')
  expect(attempt(thrown).outcome?.kind).toBe('throw')
  let reads = 0
  const fn = () => 1
  Object.defineProperty(fn, 'name', {
    get() {
      reads++
      throw new Error('getter')
    },
  })
  expect(diagnostic(fn)).toMatchObject({ kind: 'function', name: '<accessor>' })
  expect(reads).toBe(0)
})

test('error diagnostics preserve message patterns and constructors', async () => {
  const result = await run(
    new Test()
      .target(() => {
        throw new Error('actual')
      })
      .it('details', (t) =>
        t
          .args()
          .expect((e) => [e.error.toThrow('wanted'), e.error.toThrow(/wanted/i), e.error.toBeInstanceOf(TypeError)]),
      ),
  )
  const values = attempt(result).assertions
  expect(values[0]).toMatchObject({ expected: diagnostic('wanted') })
  expect(values[1]).toMatchObject({ expected: diagnostic(/wanted/i) })
  expect(values[2]).toMatchObject({ expected: diagnostic(TypeError) })
})

test('omitted objects cannot leave references to discarded diagnostic nodes', () => {
  const cause = { detail: 'retained' }
  const broken = new Proxy(new Error('broken', { cause }), {
    ownKeys() {
      throw new Error('keys unavailable')
    },
  })
  const result = diagnostic([broken, broken, cause, cause])
  expect.assert(result.kind === 'array')
  expect(result.items[0]).toMatchObject({ kind: 'omitted' })
  expect(result.items[1]).toMatchObject({ kind: 'omitted' })
  const retained = result.items[2]
  expect.assert(retained.kind === 'object')
  expect(result.items[3]).toEqual({ kind: 'reference', id: retained.id })
})

test('call diagnostics preserve counts, nth indices, and absent calls', async () => {
  const service = {
    send(id: number) {
      return id
    },
  }
  const result = await run(
    new Test()
      .target(() => service.send(7))
      .it('details', (t) =>
        t
          .args()
          .expectCalls((call) => [
            call(service, 'send').calledTimes(2),
            call(service, 'send').notCalled(),
            call(service, 'send').calledOnceWith(8),
            call(service, 'send').calledNthWith(3, 9),
          ]),
      ),
  )
  const values = attempt(result).assertions
  expect(values[0]).toMatchObject({ expected: diagnostic(2), actual: diagnostic(1) })
  expect(values[1]).toMatchObject({ expected: diagnostic(0), actual: diagnostic(1) })
  expect(values[2]).toMatchObject({
    expected: diagnostic({ count: 1, args: [8] }),
    actual: diagnostic({ count: 1, calls: [[7]] }),
  })
  expect(values[3]).toMatchObject({
    expected: diagnostic({ n: 3, args: [9] }),
    actual: diagnostic({ count: 1, args: null }),
  })
})

test('setup failures retain known call conditions as not evaluated', async () => {
  const service = { send() {} }
  const result = await run(
    new Test()
      .use(
        middleware(async () => {
          throw new Error('setup failed')
        }),
      )
      .target(() => service.send())
      .it('setup', (t) => t.args().expectCalls((call) => [call(service, 'send').notCalled()])),
  )
  expect(attempt(result).assertions).toMatchObject([{ status: 'not-evaluated', assertion: { matcher: 'notCalled' } }])
})
