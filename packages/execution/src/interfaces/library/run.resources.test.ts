import { createTestTarget } from '@zeltjs/testing/vitest'
import { LibraryRun } from './run.js'
import { ValueComparison } from '../../infrastructure/comparison.js'
import { LocalExecutor } from '../../infrastructure/execution/local.js'
import { expect, test } from 'vite-plus/test'
import { Test, middleware, resource } from '../../../../../src/index.js'
import type { RunResult, TestDefinition, TestResult } from '../../../../../src/index.js'
import type { RunInput } from './run.js'

function suite(result: RunResult, index = 0): TestResult {
  const node = result.tests[index]
  expect.assert(node.kind === 'test')
  return node
}
const identity = (s: string) => s

/** 合意したsingleton・直接公開・依存逆順cleanup・retryを同じ利用シナリオで検証する。 */
test('hoists dependencies once, exposes direct fields and cleans up in reverse order after retries', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const log: string[] = []
  const db = resource({
    name: 'db',
    scope: 'perRun',
    async setup(_, next) {
      log.push('db open')
      try {
        return await next({ dbUrl: 'db://local' })
      } finally {
        log.push('db close')
      }
    },
  })
  const schema = resource({
    name: 'schema',
    scope: 'perWorker',
    require: [db],
    async setup(ctx, next) {
      log.push(`schema open ${ctx.dbUrl}`)
      try {
        return await next({ schemaUrl: `${ctx.dbUrl}/schema` })
      } finally {
        log.push('schema close')
      }
    },
  })
  let attempt = 0
  const a = new Test()
    .require(schema)
    .require(schema)
    .target((url: string) => {
      log.push(`case ${++attempt}`)
      return url
    })
    .it('retry', (t) =>
      t
        .retry(1)
        .argsFrom((ctx) => [ctx.schemaUrl])
        .expect((e) => [e.result.toBe('db://local/schema'), e.result.toSatisfy(() => attempt === 2)]),
    )
  const b = new Test().target(identity).it('case requirement', (t) =>
    t
      .require(schema)
      .argsFrom((ctx) => [ctx.schemaUrl])
      .expect((e) => [e.result.toBe('db://local/schema'), e.result.toSatisfy(() => !Object.hasOwn(e.ctx, 'dbUrl'))]),
  )
  const result = await run([a, b])
  expect(result.status).toBe('passed')
  expect(result.resources?.map((r) => [r.name, r.middleware.status])).toEqual([
    ['db', 'passed'],
    ['schema', 'passed'],
  ])
  expect(log).toEqual(['db open', 'schema open db://local', 'case 1', 'case 2', 'schema close', 'db close'])
  expect(suite(result).cases[0].attempts).toHaveLength(2)
  await run(b)
  expect(log.filter((s) => s === 'db open')).toHaveLength(2)
})

test('group requirement reaches nested group middleware and independent child cases', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const seed = resource({
    scope: 'perRun',
    async setup(_, next) {
      return await next({ seed: 3 })
    },
  })
  const child = new Test<{ seed: number }>()
    .target((n: number) => n)
    .it('child', (t) => t.argsFrom((ctx) => [ctx.seed]).expect((e) => [e.result.toBe(3)]))
  const nested = new Test<{ seed: number }>().group(
    'inner',
    middleware(async (ctx, next) => {
      expect(ctx.seed).toBe(3)
      return await next()
    }),
    [child],
  )
  const parent = new Test().require(seed).group(
    'outer',
    middleware(async (ctx, next) => {
      expect(ctx.seed).toBe(3)
      return await next()
    }),
    [nested],
  )
  expect((await run(parent)).status).toBe('passed')
})

test('starts only the resources required by selected executable cases', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const called: string[] = []
  const unused = resource({
    scope: 'perRun',
    async setup(_, next) {
      called.push('unused')
      return await next({ u: 1 })
    },
  })
  const used = resource({
    scope: 'perRun',
    async setup(_, next) {
      called.push('used')
      return await next({ v: 1 })
    },
  })
  const cases = new Test()
    .target(() => 1)
    .skip('skip', (t) =>
      t
        .require(unused)
        .args()
        .expect((e) => [e.result.toBe(1)]),
    )
    .it('ordinary', (t) =>
      t
        .require(unused)
        .args()
        .expect((e) => [e.result.toBe(1)]),
    )
    .only('selected', (t) =>
      t
        .require(used)
        .args()
        .expect((e) => [e.result.toBe(1)]),
    )
  expect((await run(cases)).status).toBe('passed')
  expect(called).toEqual(['used'])
  called.length = 0
  const options: RunInput = { filter: 'skip' }
  expect((await run(cases, options)).status).toBe('passed')
  expect(called).toEqual([])
  const skipped = new Test()
    .require(unused)
    .target(() => 1)
    .todo('future')
  await run(skipped)
  expect(called).toEqual([])
})

test('setup failure cancels dependents, continues independent cases and still cleans up dependencies', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const log: string[] = []
  const db = resource({
    name: 'db',
    scope: 'perRun',
    async setup(_, next) {
      try {
        return await next({ url: 'db' })
      } finally {
        log.push('db close')
      }
    },
  })
  const bad = resource({
    name: 'bad',
    scope: 'perWorker',
    require: [db],
    async setup() {
      throw new Error('setup failed')
    },
  })
  const blocked = new Test()
    .require(bad)
    .target(() => {
      log.push('blocked')
      return 1
    })
    .it('dependent', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  const independent = new Test()
    .target(() => {
      log.push('independent')
      return 1
    })
    .it('independent', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  const result = await run([blocked, independent])
  expect(result.status).toBe('failed')
  expect(suite(result).cases[0].notRun).toBe('cancelled')
  expect(suite(result, 1).cases[0].attempts[0]?.status).toBe('passed')
  expect(result.resources?.[1].middleware).toMatchObject({ status: 'failed', cleanup: 'complete' })
  expect(log).toEqual(['independent', 'db close'])
})

test('does not treat a case assertion failure as resource failure', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const r = resource({
    scope: 'perRun',
    async setup(_, next) {
      return await next({ n: 1 })
    },
  })
  const result = await run(
    new Test()
      .require(r)
      .target(() => 1)
      .it('fail', (t) => t.args().expect((e) => [e.result.toBe(2)])),
  )
  expect(result.status).toBe('failed')
  expect(result.resources?.[0].middleware.status).toBe('passed')
})

test('reports cleanup failure separately from successful cases', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const r = resource({
    scope: 'perRun',
    async setup(_, next) {
      try {
        return await next({ n: 1 })
      } finally {
        await Promise.reject(new Error('drop failed'))
      }
    },
  })
  const result = await run(
    new Test()
      .require(r)
      .target(() => 1)
      .it('pass', (t) => t.args().expect((e) => [e.result.toBe(1)])),
  )
  expect(result).toMatchObject({ status: 'failed', reason: 'cleanup-failed' })
  expect(suite(result).cases[0].attempts[0]?.status).toBe('passed')
  expect(result.resources?.[0].middleware).toMatchObject({ status: 'failed', cleanup: 'incomplete' })
})

test('resource inputs are frozen and supplied data is isolated between cases', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const state = { count: 1 }
  const a = resource({
    scope: 'perRun',
    async setup(_, next) {
      return await next({ state })
    },
  })
  const b = resource({
    scope: 'perWorker',
    require: [a],
    async setup(ctx, next) {
      expect(Object.isFrozen(ctx.state)).toBe(true)
      return await next({ state: ctx.state })
    },
  })
  const cases = new Test()
    .require(b)
    .target((s: { count: number }) => s.count++)
    .it('first', (t) => t.argsFrom((ctx) => [ctx.state]).expect((e) => [e.result.toBe(1)]))
    .it('second', (t) => t.argsFrom((ctx) => [ctx.state]).expect((e) => [e.result.toBe(1)]))
  expect((await run(cases)).status).toBe('passed')
  expect(state.count).toBe(1)
})

test('rejects collisions between distinct resources and keeps middleware overrides', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const a = resource({
    scope: 'perRun',
    async setup(_, next) {
      return await next({ url: 'a' })
    },
  })
  const b = resource({
    scope: 'perRun',
    async setup(_, next) {
      return await next({ url: 'b' })
    },
  })
  const cases = new Test()
    .require(a)
    .require(b)
    .target(identity)
    .it('collision', (t) => t.argsFrom((ctx) => [ctx.url]).expect((e) => [e.result.toBe('b')]))
  await expect(run(cases)).rejects.toThrow('resource context key collision: url')
  const overridden = new Test()
    .require(a)
    .use(
      middleware(async (ctx, next) => {
        expect(ctx.url).toBe('a')
        return await next({ url: 'override' })
      }),
    )
    .target(identity)
    .it('override', (t) => t.argsFrom((ctx) => [ctx.url]).expect((e) => [e.result.toBe('override')]))
  expect((await run(overridden)).status).toBe('passed')
})

test('resource timeout reports the resource and does not hang on a pending setup', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const r = resource({ name: 'pending', scope: 'perRun', timeout: 10, setup: () => new Promise<never>(() => {}) })
  const result = await run(
    new Test()
      .require(r)
      .target(() => 1)
      .it('blocked', (t) => t.args().expect((e) => [e.result.toBe(1)])),
  )
  expect(result).toMatchObject({ status: 'failed', reason: 'timeout' })
  expect(result.resources?.[0].middleware).toMatchObject({
    status: 'failed',
    cleanup: 'incomplete',
    failures: [{ kind: 'timeout', phase: 'before' }],
  })
})

/** finished definitions remain assignable to the scope-independent public run input. */
const definition: TestDefinition = new Test()
  .require(
    resource({
      scope: 'perRun',
      async setup(_, next) {
        return await next({ id: 1 })
      },
    }),
  )
  .target(() => 1)
  .it('typed', (t) => t.args().expect((e) => [e.result.toBe(e.ctx.id)]))
void definition

test('middleware remains the final context provider when require is declared after use', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const data = resource({
    scope: 'perRun',
    async setup(_, next) {
      return await next({ value: 1 })
    },
  })
  const cases = new Test()
    .use(middleware(async (_, next) => next({ value: 'middleware' })))
    .require(data)
    .target((value: string) => value)
    .it('typed override', (t) => t.argsFrom((ctx) => [ctx.value]).expect((e) => [e.result.toBe('middleware')]))
  expect((await run(cases)).status).toBe('passed')
})

test('every retry receives a fresh copy of supplied data', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  let attempt = 0
  const data = resource({
    scope: 'perRun',
    async setup(_, next) {
      return await next({ state: { count: 0 } })
    },
  })
  const cases = new Test()
    .require(data)
    .target((state: { count: number }) => state.count++)
    .it('retry', (t) =>
      t
        .retry(1)
        .argsFrom((ctx) => [ctx.state])
        .expect((e) => [e.result.toBe(0), e.result.toSatisfy(() => ++attempt === 2)]),
    )
  const result = await run(cases)
  expect(result.status).toBe('passed')
  expect(suite(result).cases[0].attempts).toHaveLength(2)
})

test('interruption of pending setup returns a cancelled resource and still releases its dependencies', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const signal = new AbortController()
  const log: string[] = []
  const parent = resource({
    scope: 'perRun',
    async setup(_, next) {
      try {
        return await next({ id: 1 })
      } finally {
        log.push('parent closed')
      }
    },
  })
  const pending = resource({
    scope: 'perWorker',
    require: [parent],
    setup: () => {
      signal.abort()
      return new Promise<never>(() => {})
    },
  })
  const options: RunInput = { signal: signal.signal }
  const result = await run(
    new Test()
      .require(pending)
      .target(() => 1)
      .it('blocked', (t) => t.args().expect((e) => [e.result.toBe(1)])),
    options,
  )
  expect(result).toMatchObject({ status: 'cancelled', reason: 'interrupted' })
  expect(result.resources?.[1].middleware).toMatchObject({ status: 'cancelled', cleanup: 'incomplete' })
  expect(log).toEqual(['parent closed'])
})
