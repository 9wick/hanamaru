import { onTest } from '@zeltjs/testing/vitest'
import { createApp } from '@zeltjs/core'
import { override } from '@zeltjs/core/internal-bridge/testing'
import { WorkerExecutionLauncher } from '../workers/client.js'
import { InlineRunHarness } from '../../testing/inline-execution.test.js'
import { LocalExecutor } from '../../testing/inline-execution.test.js'
import { expect, test } from 'vite-plus/test'
import { Test, middleware, environment, tuples, valueAdapter } from '../../../../../src/index.js'
import type { RunResult } from '../../domain/result/types.js'

import { diagnostic } from '../../domain/result/diagnostic.js'

function attempt(result: RunResult) {
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  const value = node.cases[0].attempts[0]
  expect.assert(value !== undefined)
  return value
}

test('inspection errors cannot turn a return into an expected throw', async () => {
  const scope = await onTest(createApp([]))
  override(scope, [{ provide: WorkerExecutionLauncher, useValue: await scope.get(LocalExecutor) }])
  const library = await scope.get(InlineRunHarness)
  const run = library.run.bind(library)

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
    .it('must throw', (t) => t.args().expect((e) => [e.error.message.toEqual('inspection exploded')]))
  const result = await run(definition)
  expect(result.status).toBe('failed')
  expect(attempt(result).outcome).toEqual({
    kind: 'return',
    value: { kind: 'omitted', reason: 'inspection failed: inspection exploded' },
  })
  expect(attempt(result).assertions[0].status).toBe('not-evaluated')
})

test('inspection preserves return and throw identity and never reads function name getters', async () => {
  const scope = await onTest(createApp([]))
  override(scope, [{ provide: WorkerExecutionLauncher, useValue: await scope.get(LocalExecutor) }])
  const library = await scope.get(InlineRunHarness)
  const run = library.run.bind(library)

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
      .property('throw', (p) =>
        p
          .forAll(tuples())
          .expect((e) => [
            e
              .on(e.project(e.outcome, (exit) => exit.kind === 'throw' && exit.error === value))
              .satisfies('preserves thrown identity', (matches) => matches),
          ]),
      ),
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

test('error diagnostics preserve concrete messages and named property conditions', async () => {
  const scope = await onTest(createApp([]))
  override(scope, [{ provide: WorkerExecutionLauncher, useValue: await scope.get(LocalExecutor) }])
  const library = await scope.get(InlineRunHarness)
  const definition = new Test()
    .target(() => {
      throw new Error('actual')
    })
    .it('message', (t) => t.args().expect((e) => [e.error.message.toEqual('wanted')]))
    .property('pattern', (p) =>
      p
        .forAll(tuples())
        .expect((e) => [
          e
            .on(e.error.ofType(Error).field('message'))
            .satisfies('wanted pattern', (message) => /wanted/i.test(message)),
        ]),
    )
  const result = await library.run(definition)
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  expect(node.cases[0].attempts[0]?.assertions[0]).toMatchObject({
    expected: diagnostic('wanted'),
    actual: diagnostic('actual'),
  })
  expect(node.cases[1].attempts[0]?.assertions[0]).toMatchObject({
    expected: diagnostic('wanted pattern'),
    actual: diagnostic('actual'),
  })
})

test('call-record observations report counts and saved request data without claiming real effects', async () => {
  const scope = await onTest(createApp([]))
  override(scope, [{ provide: WorkerExecutionLauncher, useValue: await scope.get(LocalExecutor) }])
  const library = await scope.get(InlineRunHarness)
  const local = environment(async (_, scope, next) => {
    const requests: number[] = []
    const send = (id: number) => {
      requests.push(id)
      return id
    }
    const action = scope.action({
      evidence: 'call-record',
      open: () => ({ finish: () => [...requests], dispose: () => {} }),
    })
    return next({ send, action })
  })
  const result = await library.run(
    new Test()
      .target((send: (id: number) => number) => send(7))
      .effectful()
      .use(local)
      .it('details', (t) =>
        t
          .argsFrom((ctx) => [ctx.send])
          .expect((e) => [
            e.action(e.ctx.action).untilTargetSettles().count(2),
            e.action(e.ctx.action).untilTargetSettles().none(),
            e.action(e.ctx.action).untilTargetSettles().toEqual([8]),
          ]),
      ),
  )
  const values = attempt(result).assertions
  expect(values[0]?.assertion.observations).toMatchObject([
    { kind: 'action', evidence: 'call-record', window: { kind: 'settled' } },
  ])
  expect(values[0]).toMatchObject({
    assertion: { evidence: 'call-record' },
    expected: diagnostic(2),
    actual: diagnostic(1),
  })
  expect(values[1]).toMatchObject({ expected: diagnostic(0), actual: diagnostic(1) })
  expect(values[2]).toMatchObject({ expected: diagnostic([8]), actual: diagnostic([7]) })
})

test('prepare failures do not invent conditions that could not be compiled', async () => {
  const scope = await onTest(createApp([]))
  override(scope, [{ provide: WorkerExecutionLauncher, useValue: await scope.get(LocalExecutor) }])
  const library = await scope.get(InlineRunHarness)
  let built = 0
  const result = await library.run(
    new Test()
      .use(
        middleware(async () => {
          throw new Error('setup failed')
        }),
      )
      .target(() => 1)
      .it('setup', (t) =>
        t.args().expect((e) => {
          built++
          return [e.result.toEqual(1)]
        }),
      ),
  )
  expect(built).toBe(0)
  expect(attempt(result).assertions).toEqual([])
  expect(attempt(result).evaluations).toMatchObject([
    { kind: 'example', input: { kind: 'omitted' }, assertions: [], failureIndexes: [0] },
  ])
  expect(attempt(result).failures[0]?.kind).toBe('execution')
})

test('comparison diagnostics cannot turn a valid structural match into an execution failure', async () => {
  const scope = await onTest(createApp([]))
  override(scope, [{ provide: WorkerExecutionLauncher, useValue: await scope.get(LocalExecutor) }])
  const library = await scope.get(InlineRunHarness)
  const prototype = new Proxy(
    {},
    {
      getOwnPropertyDescriptor() {
        throw new Error('prototype name unavailable')
      },
    },
  )
  const actual = { value: 1 },
    expected = { value: 1 }
  expect(Reflect.setPrototypeOf(actual, prototype)).toBe(true)
  expect(Reflect.setPrototypeOf(expected, prototype)).toBe(true)
  const result = await library.run(
    new Test()
      .target(() => actual)
      .it('same public value', (t) => t.args().expect((e) => [e.result.toEqual(expected)])),
  )
  expect(result.status).toBe('passed')
  expect(attempt(result).assertions[0]).toMatchObject({
    status: 'passed',
    actual: { kind: 'omitted', reason: 'inspection failed: prototype name unavailable' },
  })
})

test('tolerance diagnostics retain the selected tolerance and measured difference', async () => {
  const scope = await onTest(createApp([]))
  override(scope, [{ provide: WorkerExecutionLauncher, useValue: await scope.get(LocalExecutor) }])
  const library = await scope.get(InlineRunHarness)
  const result = await library.run(
    new Test()
      .target(() => 1.5)
      .it('outside tolerance', (t) => t.args().expect((e) => [e.result.toBeCloseTo(1, { absoluteTolerance: 0.1 })])),
  )
  expect(result.status).toBe('failed')
  expect(attempt(result).assertions[0]).toMatchObject({
    expected: diagnostic({ value: 1, absoluteTolerance: 0.1 }),
    actual: diagnostic({ value: 1.5, difference: 0.5 }),
  })
})

test('adapter and exception type diagnostics retain the declared type without rerunning capture', async () => {
  const scope = await onTest(createApp([]))
  override(scope, [{ provide: WorkerExecutionLauncher, useValue: await scope.get(LocalExecutor) }])
  const library = await scope.get(InlineRunHarness)
  class Money {
    #minor: number
    constructor(minor: number) {
      this.#minor = minor
    }
    minor() {
      return this.#minor
    }
  }
  let captures = 0
  const adapter = valueAdapter(Money, (money) => {
    captures++
    return { minor: money.minor() }
  })
  const money = await library.run(
    new Test()
      .target(() => new Money(120))
      .it('price', (t) => t.args().expect((e) => [e.result.toEqual(new Money(100), adapter)])),
  )
  expect(attempt(money).assertions[0]?.assertion.adapterType).toMatchObject({ kind: 'function', name: 'Money' })
  expect(captures).toBe(2)
  const error = await library.run(
    new Test()
      .target(() => {
        throw new Error('bad')
      })
      .it('type', (t) => t.args().expect((e) => [e.error.ofType(TypeError).part('message').toEqual('bad')])),
  )
  expect(attempt(error).assertions[0]?.assertion.errorTypes).toEqual([diagnostic(TypeError)])
})

test('state diagnostics retain resolved observation arguments and timing', async () => {
  const scope = await onTest(createApp([]))
  override(scope, [{ provide: WorkerExecutionLauncher, useValue: await scope.get(LocalExecutor) }])
  const library = await scope.get(InlineRunHarness)
  const local = environment(async (_, scope, next) =>
    next({ saved: scope.state({ evidence: 'substitute-effect', read: (id: string) => ({ id, count: 1 }) }) }),
  )
  const result = await library.run(
    new Test()
      .target(() => ({ id: 'generated' }))
      .effectful()
      .use(local)
      .it('observed result id', (t) =>
        t.args().expect((e) => [e.state(e.ctx.saved, e.result.field('id')).part('count').toEqual(2)]),
      ),
  )
  expect(attempt(result).assertions[0]?.assertion.observations).toMatchObject([
    { kind: 'state', evidence: 'substitute-effect', args: [diagnostic('generated')], timing: { kind: 'after-plan' } },
  ])
})

test('missing paths and mismatched exception types show user values, not internal results', async () => {
  const scope = await onTest(createApp([]))
  override(scope, [{ provide: WorkerExecutionLauncher, useValue: await scope.get(LocalExecutor) }])
  const library = await scope.get(InlineRunHarness)
  const missing = await library.run(
    new Test()
      .target((): { name?: string } => ({}))
      .it('missing field', (t) => t.args().expect((e) => [e.result.part('name').toEqual('Alice')])),
  )
  expect(attempt(missing).failures[0]).toMatchObject({ kind: 'assertion', actual: { kind: 'missing' } })
  const thrown = await library.run(
    new Test()
      .target(() => {
        throw 'plain'
      })
      .it('not an Error', (t) => t.args().expect((e) => [e.error.message.toEqual('plain')])),
  )
  expect(attempt(thrown).failures[0]).toMatchObject({ kind: 'assertion', actual: { kind: 'string', value: 'plain' } })
  class Wrong extends Error {
    code = 'wrong'
  }
  class Wanted extends Error {
    code = 'wanted'
  }
  const mismatch = await library.run(
    new Test()
      .target(() => {
        throw new Wrong('failure')
      })
      .it('wrong error', (t) => t.args().expect((e) => [e.error.ofType(Wanted).part('code').toEqual('wanted')])),
  )
  expect(attempt(mismatch).failures[0]).toMatchObject({ kind: 'assertion', actual: { kind: 'object', type: 'Wrong' } })
})
