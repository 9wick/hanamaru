import { onTest } from '@zeltjs/testing/vitest'
import { createApp } from '@zeltjs/core'
import { override } from '@zeltjs/core/internal-bridge/testing'
import { expect, test } from 'vite-plus/test'
import { Test, environment } from '../../../../../src/index.js'
import { WorkerExecutionLauncher } from '../workers/client.js'
import { InlineRunHarness, LocalExecutor } from '../../testing/inline-execution.test.js'

async function harness() {
  const scope = await onTest(createApp([]))
  override(scope, [{ provide: WorkerExecutionLauncher, useValue: await scope.get(LocalExecutor) }])
  return scope.get(InlineRunHarness)
}

test('receiver, arguments and expectations resolve once in each fresh retry environment', async () => {
  const library = await harness()
  const log: string[] = []
  class Client {
    readonly sent: number[] = []
    send(id: number) {
      log.push(`target${id}`)
      this.sent.push(id)
      return id
    }
  }
  let attempts = 0
  const clients: Client[] = []
  const local = environment(async (_, scope, next) => {
    const id = ++attempts,
      client = new Client(),
      original = client.send
    clients.push(client)
    try {
      return await next({ id, client, sent: scope.state({ evidence: 'real-effect', read: () => client.sent }) })
    } finally {
      expect(client.send).toBe(original)
      log.push(`cleanup${id}`)
    }
  })
  const definition = new Test()
    .target(Client, 'send')
    .effectful()
    .use(local)
    .from((ctx) => {
      log.push(`receiver${ctx.id}`)
      return ctx.client
    })
    .it('retry', (t) =>
      t
        .retry(1)
        .argsFrom((ctx) => {
          log.push(`args${ctx.id}`)
          return [ctx.id]
        })
        .expect((e) => {
          log.push(`expect${e.ctx.id}`)
          return [e.result.toEqual(2), e.state(e.ctx.sent).toEqual([e.ctx.id])]
        }),
    )
  expect(log).toEqual([])
  expect((await library.run(definition)).status).toBe('passed')
  expect(log).toEqual([
    'receiver1',
    'args1',
    'expect1',
    'target1',
    'cleanup1',
    'receiver2',
    'args2',
    'expect2',
    'target2',
    'cleanup2',
  ])
  expect(clients[0]).not.toBe(clients[1])
})

test('observation parameters use the saved generated result rather than a fixed environment input', async () => {
  const library = await harness()
  interface User {
    id: string
    name: string
  }
  class Registry {
    readonly rows = new Map<string, User>()
    create(name: string) {
      const row = { id: 'generated', name }
      this.rows.set(row.id, row)
      return { id: row.id }
    }
  }
  const local = environment(async (_, scope, next) => {
    const registry = new Registry()
    return next({
      registry,
      saved: scope.state({ evidence: 'real-effect', read: (id: string) => registry.rows.get(id) }),
    })
  })
  const definition = new Test()
    .target(Registry, 'create')
    .effectful()
    .use(local)
    .from((ctx) => ctx.registry)
    .it('lookup returned id', (t) =>
      t
        .args('Alice')
        .expect((e) => [e.state(e.ctx.saved, e.result.field('id')).toEqual({ id: 'generated', name: 'Alice' })]),
    )
  expect((await library.run(definition)).status).toBe('passed')
})

test.each(['receiver', 'arguments'])(
  '%s resolution failure skips target and unwinds the environment',
  async (failing) => {
    const library = await harness()
    let targets = 0,
      cleanups = 0
    class Service {
      run() {
        targets++
        return 1
      }
    }
    const local = environment(async (_, _scope, next) => {
      try {
        return await next({ service: new Service() })
      } finally {
        cleanups++
      }
    })
    const definition = new Test()
      .target(Service, 'run')
      .effectful()
      .use(local)
      .from((ctx) => {
        if (failing === 'receiver') throw new Error('receiver unavailable')
        return ctx.service
      })
      .it('resolution', (t) =>
        t
          .argsFrom(() => {
            if (failing === 'arguments') throw new Error('arguments unavailable')
            return []
          })
          .expect((e) => [e.result.toEqual(1)]),
      )
    const result = await library.run(definition)
    expect(result.status).toBe('failed')
    expect(targets).toBe(0)
    expect(cleanups).toBe(1)
    const node = result.tests[0]
    expect.assert(node.kind === 'test')
    expect(node.cases[0].attempts[0]).toMatchObject({
      assertions: [],
      failures: [{ kind: 'execution', phase: 'compile' }],
    })
  },
)

test('skipped cases do not resolve receivers, inputs or observation conditions', async () => {
  const library = await harness()
  let resolves = 0
  class Service {
    run(id: number) {
      return id
    }
  }
  const definition = new Test()
    .target(Service, 'run')
    .from(() => {
      resolves++
      return new Service()
    })
    .skip('skip', (t) =>
      t
        .argsFrom(() => {
          resolves++
          return [1]
        })
        .expect((e) => {
          resolves++
          return [e.result.toEqual(1)]
        }),
    )
  expect((await library.run(definition)).status).toBe('passed')
  expect(resolves).toBe(0)
})
