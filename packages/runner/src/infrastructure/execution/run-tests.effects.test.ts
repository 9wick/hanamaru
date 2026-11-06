import { onTest } from '@zeltjs/testing/vitest'
import { createApp } from '@zeltjs/core'
import { override } from '@zeltjs/core/internal-bridge/testing'
import { expect, test } from 'vite-plus/test'
import { Test, environment, tuples, scenario, constant } from '../../../../../src/index.js'
import { WorkerExecutionLauncher } from '../workers/client.js'
import { InlineRunHarness, LocalExecutor } from '../../testing/inline-execution.test.js'

async function harness() {
  const scope = await onTest(createApp([]))
  override(scope, [{ provide: WorkerExecutionLauncher, useValue: await scope.get(LocalExecutor) }])
  return scope.get(InlineRunHarness)
}

test('typed fake dependencies expose model state without replacing target methods', async () => {
  const library = await harness()
  interface Store {
    save(id: string): void
  }
  class Service {
    readonly store: Store
    constructor(store: Store) {
      this.store = store
    }
    register(id: string) {
      this.store.save(id)
      return id
    }
  }
  const local = environment(async (_, scope, next) => {
    const rows = new Set<string>()
    const store: Store = {
      save(id) {
        if (rows.has(id)) throw new Error('duplicate')
        rows.add(id)
      },
    }
    return next({
      service: new Service(store),
      stored: scope.state({ evidence: 'substitute-effect', read: () => [...rows] }),
    })
  })
  const definition = new Test()
    .target(Service, 'register')
    .effectful()
    .use(local)
    .from((ctx) => ctx.service)
    .it('stored', (t) =>
      t.args('user').expect((e) => [e.result.toEqual('user'), e.state(e.ctx.stored).toEqual(['user'])]),
    )
  const result = await library.run(definition)
  expect(result.status).toBe('passed')
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  expect(node.cases[0].attempts[0]?.assertions[1]?.assertion).toMatchObject({
    subject: 'state',
    evidence: 'substitute-effect',
  })
})

test('real state observations include a method target responsibility', async () => {
  const library = await harness()
  const counter = {
    value: 0,
    increment() {
      this.value++
      return this.value
    },
  }
  const local = environment(async (_, scope, next) =>
    next({ count: scope.state({ evidence: 'real-effect', read: () => counter.value }) }),
  )
  const definition = new Test()
    .target(counter, 'increment')
    .effectful()
    .use(local)
    .it('incremented', (t) => t.args().expect((e) => [e.state(e.ctx.count).toEqual(1)]))
  expect((await library.run(definition)).status).toBe('passed')
})

test('observation cleanup runs after failed expectations and preserves the original method', async () => {
  const library = await harness()
  const log: string[] = []
  const target = Object.freeze({ run: (): number => 1 })
  const original = target.run
  const local = environment(async (_, scope, next) => {
    const action = scope.action({
      evidence: 'real-effect',
      open: () => ({
        finish: () => [],
        dispose: () => {
          log.push('dispose')
        },
      }),
    })
    try {
      return await next({ action })
    } finally {
      log.push('environment cleanup')
    }
  })
  const definition = new Test()
    .target(target, 'run')
    .effectful()
    .use(local)
    .it('failed', (t) =>
      t.args().expect((e) => [e.result.toEqual(2), e.action(e.ctx.action).untilTargetSettles().none()]),
    )
  expect((await library.run(definition)).status).toBe('failed')
  expect(log).toEqual(['dispose', 'environment cleanup'])
  expect(target.run).toBe(original)
})

test('cleanup failure preserves the contract failure and prevents retries or later cases', async () => {
  const library = await harness()
  let targets = 0,
    cleanups = 0
  const local = environment(async (_, scope, next) =>
    next({
      action: scope.action({
        evidence: 'real-effect',
        open: () => ({
          finish: () => [],
          dispose: () => {
            cleanups++
            throw new Error('dispose failed')
          },
        }),
      }),
    }),
  )
  const definition = new Test()
    .target((): number => {
      targets++
      return 1
    })
    .effectful()
    .use(local)
    .it('both failures', (t) =>
      t
        .retry(2)
        .args()
        .expect((e) => [e.result.toEqual(2), e.action(e.ctx.action).untilTargetSettles().none()]),
    )
    .it('not reached', (t) => t.args().expect((e) => [e.result.toEqual(1)]))
  const result = await library.run(definition)
  expect(result.status).toBe('failed')
  expect(targets).toBe(1)
  expect(cleanups).toBe(1)
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  expect(node.cases[0].attempts[0]?.failures.map((failure) => failure.kind)).toEqual(['assertion', 'observation'])
  expect(JSON.stringify(node.cases[0])).toContain('dispose failed')
  expect(node.cases[1].notRun).toBe('cancelled')
})

test('failed observer setup skips target and still cleans the environment', async () => {
  const library = await harness()
  let targets = 0,
    cleanups = 0
  const local = environment(async (_, scope, next) => {
    try {
      return await next({
        action: scope.action({
          evidence: 'real-effect',
          open: () => {
            throw new Error('observer unavailable')
          },
        }),
      })
    } finally {
      cleanups++
    }
  })
  const definition = new Test()
    .target((): number => {
      targets++
      return 1
    })
    .effectful()
    .use(local)
    .it('observation failed', (t) => t.args().expect((e) => [e.action(e.ctx.action).untilTargetSettles().none()]))
  const result = await library.run(definition)
  expect(result.status).toBe('failed')
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  expect(node.cases[0].attempts[0]?.assertions).toMatchObject([{ status: 'not-evaluated' }])
  expect(targets).toBe(0)
  expect(cleanups).toBe(1)
})

test('frozen methods work without an instrumentation requirement', async () => {
  const library = await harness()
  const object = Object.freeze({
    value: 8,
    read() {
      return this.value
    },
  })
  const definition = new Test()
    .target(object, 'read')
    .it('frozen', (t) => t.args().expect((e) => [e.result.toEqual(8)]))
  expect((await library.run(definition)).status).toBe('passed')
})

test('action observation includes target events and excludes prepare and cleanup events', async () => {
  const library = await harness()
  const local = environment(async (_, scope, next) => {
    const listeners = new Set<(value: number) => void>()
    const emit = (value: number) => {
      for (const listener of listeners) listener(value)
    }
    const action = scope.action({
      evidence: 'real-effect',
      open: () => {
        const events: number[] = []
        const listen = (value: number) => {
          events.push(value)
        }
        listeners.add(listen)
        return {
          finish: () => [...events],
          dispose: () => {
            listeners.delete(listen)
          },
        }
      },
    })
    emit(99)
    try {
      return await next({ emit, action })
    } finally {
      emit(100)
      expect(listeners.size).toBe(0)
    }
  })
  const definition = new Test()
    .target((emit: (value: number) => void) => emit(7))
    .effectful()
    .use(local)
    .it('window', (t) =>
      t.argsFrom((ctx) => [ctx.emit]).expect((e) => [e.action(e.ctx.action).untilTargetSettles().toEqual([7])]),
    )
  expect((await library.run(definition)).status).toBe('passed')
})

test('untilTargetSettles closes before after-plan state reads', async () => {
  const library = await harness()
  const log: string[] = []
  const local = environment(async (_, scope, next) => {
    const events: string[] = []
    let recording = false
    const emit = (event: string) => {
      if (recording) events.push(event)
    }
    const action = scope.action({
      evidence: 'call-record',
      open: () => {
        recording = true
        return {
          finish: () => {
            recording = false
            log.push('finish')
            return [...events]
          },
          dispose: () => {},
        }
      },
    })
    const saved = scope.state({
      evidence: 'real-effect',
      read: () => {
        log.push('read')
        emit('observation')
        return 1
      },
    })
    return next({ action, saved, emit })
  })
  const definition = new Test()
    .target((emit: (event: string) => void) => {
      emit('target')
      return 1
    })
    .effectful()
    .use(local)
    .it('window', (t) =>
      t
        .argsFrom((ctx) => [ctx.emit])
        .expect((e) => [
          e.state(e.ctx.saved).toEqual(1),
          e.action(e.ctx.action).untilTargetSettles().toEqual(['target']),
        ]),
    )
  expect((await library.run(definition)).status).toBe('passed')
  expect(log).toEqual(['finish', 'read'])
})

test('eventually stops on getter failure rather than retrying an observation error', async () => {
  const library = await harness()
  let reads = 0,
    getters = 0
  const local = environment(async (_, scope, next) =>
    next({
      saved: scope.state({
        evidence: 'real-effect',
        read: () => {
          reads++
          return {
            get value(): number {
              getters++
              throw new Error('read failure')
            },
          }
        },
      }),
    }),
  )
  const definition = new Test()
    .target(() => undefined)
    .effectful()
    .use(local)
    .it('read fault', (t) =>
      t
        .args()
        .expect((e) => [e.state(e.ctx.saved).eventually({ withinMs: 50, intervalMs: 5 }).part('value').toEqual(1)]),
    )
  const result = await library.run(definition)
  expect(result.status).toBe('failed')
  expect(reads).toBe(1)
  expect(getters).toBe(1)
})

test('eventually retries only the state read and never recomputes constant projections or target', async () => {
  const library = await harness()
  let reads = 0,
    projections = 0,
    targets = 0
  const local = environment(async (_, scope, next) =>
    next({
      saved: scope.state({
        evidence: 'real-effect',
        read: (id: number) => {
          reads++
          return reads >= 3 ? id : 0
        },
      }),
    }),
  )
  const definition = new Test()
    .target(() => {
      targets++
    })
    .effectful()
    .use(local)
    .property('eventual value', (p) =>
      p.forAll(tuples()).expect((e) => [
        e
          .state(
            e.ctx.saved,
            e.project(e.value({ id: 1 }), (value) => {
              projections++
              return value.id
            }),
          )
          .eventually({ withinMs: 100, intervalMs: 1 })
          .toEqual(1),
      ]),
    )
  expect((await library.run(definition)).status).toBe('passed')
  expect(reads).toBe(3)
  expect(projections).toBe(1)
  expect(targets).toBe(1)
})

test('a required result capture failure stops subsequent operations but observes completed effects', async () => {
  const library = await harness()
  let firstCalls = 0,
    laterCalls = 0,
    finishes = 0,
    disposes = 0
  const local = environment(async (_, scope, next) =>
    next({
      count: scope.state({ evidence: 'real-effect', read: () => firstCalls }),
      events: scope.action({
        evidence: 'real-effect',
        open: () => ({
          finish: () => {
            finishes++
            return [firstCalls]
          },
          dispose: () => {
            disposes++
          },
        }),
      }),
    }),
  )
  const first = (): object => {
    firstCalls++
    return new WeakMap()
  }
  const later = () => {
    laterCalls++
    return 1
  }
  const definition = new Test()
    .target(scenario({ first, later }))
    .effectful()
    .use(local)
    .it('capture fault', (t) =>
      t
        .steps((s) => ({ first: s.first.args(), later: s.later.args() }))
        .expect((e) => [
          e.result.part('first').toEqual({}),
          e.state(e.ctx.count).toEqual(1),
          e.action(e.ctx.events).untilTargetSettles().toEqual([1]),
        ]),
    )
  const result = await library.run(definition)
  expect(result.status).toBe('failed')
  expect([firstCalls, laterCalls, finishes, disposes]).toEqual([1, 0, 1, 1])
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  expect(node.cases[0].attempts[0]?.assertions.map((item) => item.status)).toEqual([
    'failed',
    'not-evaluated',
    'not-evaluated',
  ])
  expect(node.cases[0].attempts[0]?.failures).toMatchObject([{ kind: 'execution', phase: 'checkpoint' }])
  expect(node.cases[0].attempts[0]?.failures).toHaveLength(1)
})

test('unchanged at a checkpoint compares against the plan baseline, before later writes', async () => {
  const library = await harness()
  const local = environment(async (_, scope, next) => {
    const counter = { value: 0 }
    return next({ counter, count: scope.state({ evidence: 'real-effect', read: () => counter.value }) })
  })
  const read = (counter: { value: number }) => counter.value
  const write = (counter: { value: number }) => ++counter.value
  const definition = new Test()
    .target(scenario({ read, write }))
    .effectful()
    .use(local)
    .it('read leaves state unchanged', (t) =>
      t
        .steps((s) => ({ read: s.read.args(s.ctx.counter), written: s.write.args(s.ctx.counter) }))
        .expect((e) => [
          e.state(e.ctx.count).after(e.result.field('read')).unchanged(),
          e.state(e.ctx.count).toEqual(1),
        ]),
    )
  expect((await library.run(definition)).status).toBe('passed')
})

test('state reads receive independent argument data without changing the saved sample', async () => {
  const library = await harness()
  class Service {
    value = 0
    write(input: { n: number }) {
      this.value = input.n
    }
  }
  const input: { n: number } = { n: 1 }
  const local = environment(async (_, scope, next) => {
    const service = new Service()
    return next({
      service,
      saved: scope.state({
        evidence: 'real-effect',
        read: (query: { n: number }) => {
          query.n = 999
          return service.value
        },
      }),
    })
  })
  const definition = new Test()
    .target(Service, 'write')
    .effectful()
    .use(local)
    .from((ctx) => ctx.service)
    .property('saved data remains stable', (p) =>
      p.forAll(tuples(constant(input))).expect((e) => {
        const selected = e.sample(0)
        return [
          e
            .on({ selected, saved: e.state(e.ctx.saved, selected) })
            .satisfies('uses the original data', ({ selected, saved }) => selected.n === 1 && saved === 1),
        ]
      }),
    )
  expect((await library.run(definition)).status).toBe('passed')
  expect(input.n).toBe(1)
})

test('observation faults retain the stage, evidence, token and cause before and after execution', async () => {
  const library = await harness()
  for (const stage of ['before', 'after', 'open', 'finish'] as const) {
    let calls = 0
    const local = environment(async (_, scope, next) =>
      next({
        state: scope.state({
          evidence: 'substitute-effect',
          read: (key: string): number => {
            throw new Error(`read ${key}`)
          },
        }),
        action: scope.action<number>({
          evidence: 'call-record',
          open: () => {
            if (stage === 'open') throw new Error('open failed')
            return {
              finish: () => {
                throw new Error('finish failed')
              },
              dispose: () => {},
            }
          },
        }),
      }),
    )
    const definition = new Test()
      .target(() => ++calls)
      .effectful()
      .use(local)
      .it(stage, (t) =>
        t
          .args()
          .expect((e) =>
            stage === 'before'
              ? [e.state(e.ctx.state, 'u1').unchanged()]
              : stage === 'after'
                ? [e.state(e.ctx.state, 'u1').toEqual(1)]
                : [e.action(e.ctx.action).untilTargetSettles().none()],
          ),
      )
    const result = await library.run(definition)
    const node = result.tests[0]
    expect.assert(node.kind === 'test')
    const failures = node.cases[0].attempts[0]?.failures
    expect(failures).toHaveLength(1)
    expect(failures?.[0]).toMatchObject({
      kind: 'observation',
      stage,
      observation: {
        evidence: stage === 'before' || stage === 'after' ? 'substitute-effect' : 'call-record',
      },
      cause: { kind: 'object', type: 'Error' },
    })
    expect(calls).toBe(stage === 'before' || stage === 'open' ? 0 : 1)
  }
})

test('checkpoint failure cannot turn an unfinished plan into a property counterexample', async () => {
  const library = await harness()
  let calls = 0,
    reads = 0
  const local = environment(async (_, scope, next) => {
    const counter = { value: 0 }
    return next({
      counter,
      state: scope.state({
        evidence: 'real-effect',
        read: () => {
          reads++
          if (reads === 1) throw new Error('checkpoint read failed')
          return counter.value
        },
      }),
    })
  })
  const add = (counter: { value: number }, input: number) => {
    calls++
    return (counter.value += input)
  }
  const result = await library.run(
    new Test()
      .target(add)
      .effectful()
      .use(local)
      .property('two operations', (p) =>
        p
          .forAll(tuples(constant(1)))
          .steps((s) => ({ first: s.target.args(s.ctx.counter, s.input[0]), last: s.target.args(s.ctx.counter, 1) }))
          .expect((e) => [
            e
              .on({ mid: e.state(e.ctx.state).after(e.result.field('first')), end: e.state(e.ctx.state) })
              .satisfies('increases', ({ mid, end }) => end > mid),
            e.state(e.ctx.state).eventually({ withinMs: 100, intervalMs: 1 }).toEqual(2),
          ]),
      ),
  )
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  const attempt = node.cases[0].attempts[0]
  expect(attempt?.failures.map((failure) => failure.kind)).toEqual(['observation'])
  expect(attempt?.assertions.map((assertion) => assertion.status)).toEqual(['not-evaluated', 'not-evaluated'])
  expect(attempt?.property).toMatchObject({
    stopped: 'execution-failed',
    originalCounterexample: null,
    counterexample: null,
  })
  expect(calls).toBe(1)
  expect(reads).toBe(3)
})

test('state and action snapshot failures are observation failures, including eventually', async () => {
  const library = await harness()
  for (const mode of ['state', 'eventually', 'action'] as const) {
    let reads = 0
    const broken = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('snapshot failed')
        },
      },
    )
    const local = environment(async (_, scope, next) =>
      next({
        state: scope.state({
          evidence: 'real-effect',
          read: () => {
            reads++
            return broken
          },
        }),
        action: scope.action<object>({
          evidence: 'real-effect',
          open: () => ({ finish: () => [broken], dispose: () => {} }),
        }),
      }),
    )
    const result = await library.run(
      new Test()
        .target(() => 1)
        .effectful()
        .use(local)
        .it(mode, (t) =>
          t
            .args()
            .expect((e) =>
              mode === 'action'
                ? [e.action(e.ctx.action).untilTargetSettles().toEqual([])]
                : mode === 'eventually'
                  ? [e.state(e.ctx.state).eventually({ withinMs: 20, intervalMs: 1 }).toEqual({})]
                  : [e.state(e.ctx.state).toEqual({})],
            ),
        ),
    )
    const node = result.tests[0]
    expect.assert(node.kind === 'test')
    const attempt = node.cases[0].attempts[0]
    expect(attempt?.failures).toMatchObject([
      {
        kind: 'observation',
        stage: mode === 'action' ? 'finish' : 'after',
        observation: { kind: mode === 'action' ? 'action' : 'state', evidence: 'real-effect' },
      },
    ])
    expect(attempt?.assertions).toMatchObject([{ status: 'not-evaluated' }])
    expect(reads).toBe(mode === 'action' ? 0 : 1)
  }
})
