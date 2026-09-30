import { expect, test } from 'vite-plus/test'
import { Test, middleware, run } from '../../index.js'

interface Client {
  send(id: number): number
}

test('dynamic targets and arguments resolve once per attempt, before args and target, and restore', async () => {
  const log: string[] = []
  let attempt = 0
  const clients: Client[] = []
  const originals: Client['send'][] = []
  const definition = new Test()
    .use(
      middleware(async (_, next) => {
        const id = ++attempt
        const client = {
          send(value: number) {
            return value
          },
        }
        clients.push(client)
        originals.push(client.send)
        try {
          return await next({ client, id })
        } finally {
          expect(client.send).toBe(originals[id - 1])
          log.push(`cleanup${id}`)
        }
      }),
    )
    .target((client: Client, id: number) => {
      log.push(`target${id}`)
      return client.send(id)
    })
    .it('retry', (t) =>
      t
        .retry(1)
        .argsFrom((ctx) => {
          log.push(`args${ctx.id}`)
          return [ctx.client, ctx.id]
        })
        .expect((e) => [e.result.toBe(2)])
        .expectCalls((call) => [
          call
            .from((ctx) => {
              log.push(`object${ctx.id}`)
              return ctx.client
            }, 'send')
            .calledOnceWithFrom((ctx) => {
              log.push(`expected${ctx.id}`)
              return [ctx.id]
            }),
        ]),
    )
  definition.blueprint()
  expect(log).toEqual([])
  expect((await run(definition)).status).toBe('passed')
  expect(log).toEqual([
    'object1',
    'expected1',
    'args1',
    'target1',
    'cleanup1',
    'object2',
    'expected2',
    'args2',
    'target2',
    'cleanup2',
  ])
  expect(clients[0]).not.toBe(clients[1])
})

test('static targets can use all context argument matchers and case mocks', async () => {
  const service = {
    send(id: number) {
      return id
    },
  }
  const original = service.send
  const definition = new Test()
    .use(middleware(async (_, next) => next({ id: 9 })))
    .target((id: number) => service.send(id))
    .it('calls', (t) =>
      t
        .mock(service, 'send', (m) => m.returns(42))
        .argsFrom((ctx) => [ctx.id])
        .expectCalls((call) => [
          call(service, 'send').calledWithFrom((ctx) => [ctx.id]),
          call(service, 'send').calledOnceWithFrom((ctx) => [ctx.id]),
          call(service, 'send').calledNthWithFrom(1, (ctx) => [ctx.id]),
        ])
        .expect((e) => [e.result.toBe(42)]),
    )
  expect((await run(definition)).status).toBe('passed')
  expect(service.send).toBe(original)
})

test('resolver failures are attempt failures, skip target, and unwind middleware', async () => {
  let targets = 0,
    cleanups = 0
  const service = {
    send(id: number) {
      return id
    },
  }
  const definition = new Test()
    .use(
      middleware(async (_, next) => {
        try {
          return await next({ service })
        } finally {
          cleanups++
        }
      }),
    )
    .target(() => {
      targets++
    })
    .it('resolver', (t) =>
      t.args().expectCalls((call) => [
        call
          .from((ctx) => ctx.service, 'send')
          .calledWithFrom(() => {
            throw new Error('fixture resolution failed')
          }),
      ]),
    )
  const result = await run(definition)
  expect(result.status).toBe('failed')
  expect(targets).toBe(0)
  expect(cleanups).toBe(1)
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  expect(node.cases[0].attempts[0]).toMatchObject({
    assertions: [{ status: 'not-evaluated' }],
    failures: [{ phase: 'instrumentation' }],
  })
})

test('context resolvers stay unevaluated for skip and validate nth at definition', async () => {
  const service = {
    send(id: number) {
      return id
    },
  }
  let resolves = 0
  const definition = new Test()
    .target(() => 1)
    .skip('skip', (t) =>
      t.args().expectCalls((call) => [
        call
          .from(() => {
            resolves++
            return service
          }, 'send')
          .calledWithFrom(() => {
            resolves++
            return [1]
          }),
      ]),
    )
  expect((await run(definition)).status).toBe('passed')
  expect(resolves).toBe(0)
  expect(() =>
    new Test()
      .target(() => 1)
      .it('invalid', (t) => t.args().expectCalls((call) => [call(service, 'send').calledNthWithFrom(0, () => [1])])),
  ).toThrow('calledNthWith')
})
