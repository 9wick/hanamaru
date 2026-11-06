import { StateSubject } from '../../../../blueprint/src/domain/assertion/expectation.js'
import { onTest } from '@zeltjs/testing/vitest'
import { createApp } from '@zeltjs/core'
import { override } from '@zeltjs/core/internal-bridge/testing'
import { expect, test } from 'vite-plus/test'
import { Test, environment, constant, integers, strings, tuples, scenario, method } from '../../../../../src/index.js'
import { WorkerExecutionLauncher } from '../workers/client.js'
import { InlineRunHarness, LocalExecutor } from '../../testing/inline-execution.test.js'

async function harness() {
  const scope = await onTest(createApp([]))
  override(scope, [{ provide: WorkerExecutionLauncher, useValue: await scope.get(LocalExecutor) }])
  return scope.get(InlineRunHarness)
}

test('public expect compiles before execution and preserves its expected value', async () => {
  const library = await harness()
  const input = { name: 'Alice' }
  const target = (value: { name: string }) => {
    value.name = 'Wrong'
    return value
  }
  const definition = new Test()
    .target(target)
    .effectful()
    .it('mutation does not change the expectation', (t) => t.args(input).expect((e) => [e.result.toEqual(input)]))
  const result = await library.run(definition)
  expect(result.status).toBe('failed')
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  expect(node.cases[0].attempts[0]?.assertions[0]?.status).toBe('failed')
  expect(node.cases[0].caseKind).toBe('example')
  expect(node.cases[0].characteristic).toBe('effectful')
})

test('public state-only and action-only checks execute against real effects', async () => {
  const library = await harness()
  const log: string[] = []
  const local = environment(async (_, scope, next) => {
    log.push('environment')
    const box = { value: 0 }
    const events: number[] = []
    const state = scope.state({ evidence: 'real-effect', read: () => box.value })
    const action = scope.action({
      evidence: 'real-effect',
      open: () => {
        log.push('open')
        return {
          finish: () => {
            log.push('finish')
            return [...events]
          },
          dispose: () => {
            log.push('dispose')
          },
        }
      },
    })
    try {
      return await next({ box, events, state, action })
    } finally {
      log.push('cleanup')
    }
  })
  const write = (box: { value: number }, events: number[]) => {
    log.push('target')
    box.value = 1
    events.push(1)
  }
  const definition = new Test()
    .target(write)
    .effectful()
    .use(local)
    .it('state', (t) => t.argsFrom((c) => [c.box, c.events]).expect((e) => [e.state(e.ctx.state).toEqual(1)]))
    .it('event', (t) =>
      t.argsFrom((c) => [c.box, c.events]).expect((e) => [e.action(e.ctx.action).untilTargetSettles().count(1)]),
    )
  expect((await library.run(definition)).status).toBe('passed')
  expect(log).toEqual([
    'environment',
    'target',
    'cleanup',
    'environment',
    'open',
    'target',
    'finish',
    'dispose',
    'cleanup',
  ])
})

test('invalid before dependencies fail before the public target is called', async () => {
  const library = await harness()
  let calls = 0
  const local = environment(async (_, scope, next) =>
    next({ saved: scope.state({ evidence: 'real-effect', read: (id: string) => id }) }),
  )
  const definition = new Test()
    .target(() => {
      calls++
      return { id: 'new' }
    })
    .effectful()
    .use(local)
    .it('invalid before', (t) =>
      t.args().expect((e) => {
        const state = e.state(e.ctx.saved, e.result.field('id'))
        if (!(state instanceof StateSubject)) throw new Error('expected state subject')
        return [new StateSubject<string, 'state' | 'result'>(state.owner, state.source).unchanged()]
      }),
    )
  const result = await library.run(definition)
  expect(result.status).toBe('failed')
  expect(calls).toBe(0)
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  expect(node.cases[0].attempts[0]?.evaluations?.[0].expectedTermination).toBe(null)
})

test('public property uses fresh environments for every generated and shrinking evaluation', async () => {
  const library = await harness()
  let opened = 0,
    closed = 0
  const local = environment(async (_, scope, next) => {
    opened++
    const counter = { value: 0 }
    const count = scope.state({ evidence: 'real-effect', read: () => counter.value })
    try {
      return await next({ counter, count })
    } finally {
      closed++
    }
  })
  const increment = (counter: { value: number }, amount: number) => {
    counter.value += amount
    return counter.value
  }
  const definition = new Test()
    .target(increment)
    .effectful()
    .use(local)
    .property('amount is reflected in fresh state', (p) =>
      p
        .forAll(tuples(integers({ min: 1, max: 20 })), { seed: 42, runs: 8 })
        .argsFrom((ctx, sample) => [ctx.counter, sample[0]])
        .expect((e) => [
          e
            .on({ amount: e.sample(0), total: e.state(e.ctx.count) })
            .satisfies('equals amount', ({ amount, total }) => total === amount),
        ]),
    )
  const result = await library.run(definition)
  expect(result.status).toBe('passed')
  expect(opened).toBe(8)
  expect(closed).toBe(8)
})

test('public property shrinks counterexamples without turning a later passing candidate into success', async () => {
  const library = await harness()
  const definition = new Test()
    .target((n: number) => n)
    .property('less than three', (p) =>
      p
        .forAll(tuples(integers({ min: 0, max: 100 })), { seed: 42, runs: 5, maxShrinks: 20 })
        .expect((e) => [
          e.on(e.result).satisfies('less than three', (n) => n < 3),
          e.on(e.result).satisfies('at least three', (n) => n >= 3),
        ]),
    )
  const result = await library.run(definition)
  expect(result.status).toBe('failed')
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  const attempt = node.cases[0].attempts[0]
  expect.assert(attempt !== undefined)
  expect(node.cases[0].caseKind).toBe('property')
  expect(node.cases[0].characteristic).toBe('pure')
  expect(attempt.property?.seed).toBe(42)
  expect(attempt.property?.counterexample).toMatchObject({ kind: 'array', items: [{ kind: 'number', value: 3 }] })
  expect(attempt.evaluations?.some((evaluation) => evaluation.kind === 'shrink')).toBe(true)
  for (const evaluation of attempt.evaluations ?? []) {
    expect(evaluation.expectedTermination).toBe('return')
    for (const assertion of evaluation.assertions) {
      const indexes = evaluation.failureIndexes.filter((index) => {
        const failure = attempt.failures[index]
        return 'assertion' in failure && failure.assertion?.index === assertion.assertion.index
      })
      expect(assertion.failureIndexes).toEqual(indexes)
    }
  }
})

test('fixed properties run once and mixed return/throw properties use outcome', async () => {
  const library = await harness()
  let calls = 0
  const fixed = new Test()
    .target((text: string) => {
      calls++
      return text
    })
    .property('fixed string', (p) => p.forAll(tuples(constant('hello'))).expect((e) => [e.result.toEqual('hello')]))
  expect((await library.run(fixed)).status).toBe('passed')
  expect(calls).toBe(1)
  class TooLong extends Error {
    readonly length: number
    constructor(length: number) {
      super('long')
      this.length = length
    }
  }
  const mixed = new Test()
    .target((text: string) => {
      if (text.length > 2) throw new TooLong(text.length)
      return text
    })
    .property('length contract', (p) =>
      p
        .forAll(tuples(strings({ maxLength: 8 })), { seed: 2, runs: 20 })
        .expect((e) => [
          e
            .on({ text: e.input(0), exit: e.outcome.withError(TooLong, (error) => error.length) })
            .satisfies('length matches exit', ({ text, exit }) =>
              text.length > 2
                ? exit.kind === 'throw' && exit.error === text.length
                : exit.kind === 'return' && exit.value === text,
            ),
        ]),
    )
  const result = await library.run(mixed)
  expect(result.status).toBe('passed')
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  const evaluations = node.cases[0].attempts[0]?.evaluations ?? []
  expect(evaluations).toHaveLength(20)
  expect(evaluations.every((evaluation) => evaluation.expectedTermination === 'return-or-throw')).toBe(true)
  expect(new Set(evaluations.map((evaluation) => evaluation.outcome?.kind))).toEqual(new Set(['return', 'throw']))
})

test('retry reuses the chosen property seed and sample', async () => {
  const library = await harness()
  const inputs: number[] = []
  const definition = new Test()
    .target((n: number) => {
      inputs.push(n)
      return n
    })
    .property('retry same generated case', (p) =>
      p
        .retry(1)
        .forAll(tuples(integers({ min: 1, max: 100 })), { maxShrinks: 0 })
        .expect((e) => [e.on(e.result).satisfies('always fails', (n) => n < 0)]),
    )
  const result = await library.run(definition)
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  const attempts = node.cases[0].attempts
  expect(attempts).toHaveLength(2)
  expect(attempts[0]?.property?.seed).toBe(attempts[1]?.property?.seed)
  expect(inputs).toHaveLength(2)
  expect(inputs[0]).toBe(inputs[1])
})

test('the property timeout covers all candidates together', async () => {
  const library = await harness()
  let called = 0
  const definition = new Test()
    .target(async (n: number) => {
      called++
      await new Promise<void>((resolve) => setTimeout(resolve, 30))
      return n
    })
    .property('shared deadline', (p) =>
      p
        .timeout(100)
        .forAll(tuples(constant(1)), { runs: 10 })
        .expect((e) => [e.result.toEqual(1)]),
    )
  const result = await library.run(definition)
  expect(result.status).not.toBe('passed')
  expect(called).toBeLessThan(10)
})

test('class target binds a fresh service instance from each generated environment', async () => {
  const library = await harness()
  class Registry {
    readonly rows: string[]
    constructor(rows: string[]) {
      this.rows = rows
    }
    register(name: string) {
      this.rows.push(name)
      return this.rows.length
    }
  }
  let prepared = 0
  const local = environment(async (_, scope, next) => {
    prepared++
    const rows: string[] = []
    return next({ service: new Registry(rows), stored: scope.state({ evidence: 'real-effect', read: () => rows }) })
  })
  const definition = new Test()
    .target(Registry, 'register')
    .effectful()
    .use(local)
    .from((ctx) => ctx.service)
    .property('register one user', (p) =>
      p
        .forAll(tuples(strings()), { seed: 2, runs: 6 })
        .expect((e) => [
          e.result.toEqual(1),
          e
            .on({ name: e.input(0), stored: e.state(e.ctx.stored) })
            .satisfies('stored user', ({ name, stored }) => stored.length === 1 && stored[0] === name),
        ]),
    )
  expect((await library.run(definition)).status).toBe('passed')
  expect(prepared).toBe(6)
})

test('class targets reject foreign receivers and accessors before invoking target code', async () => {
  const library = await harness()
  class Service {
    run() {
      return 1
    }
  }
  const foreign = new Test()
    .target(Service, 'run')
    .from(() => ({ run: () => 1 }))
    .it('wrong class', (t) => t.args().expect((e) => [e.result.toEqual(1)]))
  expect((await library.run(foreign)).status).toBe('failed')
  let getterReads = 0
  class GetterService {
    get run() {
      getterReads++
      return () => 1
    }
  }
  const accessor = new Test()
    .target(GetterService, 'run')
    .from(() => new GetterService())
    .it('not a data property', (t) => t.args().expect((e) => [e.result.toEqual(1)]))
  expect((await library.run(accessor)).status).toBe('failed')
  expect(getterReads).toBe(0)
})

test('class targets support public function fields and overridden subclass operations', async () => {
  const library = await harness()
  class Base {
    run = () => 1
  }
  class Derived extends Base {
    override run = () => 2
  }
  const definition = new Test()
    .target(Base, 'run')
    .from(() => new Derived())
    .it('public operation', (t) => t.args().expect((e) => [e.result.toEqual(2)]))
  expect((await library.run(definition)).status).toBe('passed')
})

test('single-target property steps compare multiple invocations', async () => {
  const library = await harness()
  const definition = new Test()
    .target((a: number, b: number) => a + b)
    .property('commutative', (p) =>
      p
        .forAll(tuples(integers({ min: -10, max: 10 }), integers({ min: -10, max: 10 })), { seed: 4, runs: 6 })
        .steps((s) => ({ ab: s.target.args(s.input[0], s.input[1]), ba: s.target.args(s.input[1], s.input[0]) }))
        .expect((e) => [
          e
            .on({ ab: e.result.field('ab'), ba: e.result.field('ba') })
            .satisfies('same result', ({ ab, ba }) => ab === ba),
        ]),
    )
  expect((await library.run(definition)).status).toBe('passed')
})

test('step result records preserve each operation value before later mutation', async () => {
  const library = await harness()
  const local = environment(async (_, scope, next) => {
    const box = { value: 0 }
    return next({ box, state: scope.state({ evidence: 'real-effect', read: () => box.value }) })
  })
  const mutate = (box: { value: number }) => {
    box.value++
    return box
  }
  const definition = new Test()
    .target(mutate)
    .effectful()
    .use(local)
    .property('captured operation results', (p) =>
      p
        .forAll(tuples())
        .steps((s) => ({ first: s.target.args(s.ctx.box), second: s.target.args(s.ctx.box) }))
        .expect((e) => [
          e.result.toEqual({ first: { value: 1 }, second: { value: 2 } }),
          e.on(e.result).satisfies('increased once', (record) => record.first.value + 1 === record.second.value),
          e.state(e.ctx.state).after(e.result.field('first')).toEqual(1),
          e.state(e.ctx.state).toEqual(2),
        ]),
    )
  expect((await library.run(definition)).status).toBe('passed')
})

test('final permits a failure only in the last declared operation', async () => {
  const library = await harness()
  class Duplicate extends Error {}
  class Registry {
    readonly users = new Set<string>()
    register(user: string) {
      if (this.users.has(user)) throw new Duplicate('duplicate')
      this.users.add(user)
      return user
    }
  }
  const local = environment(async (_, _scope, next) => next({ registry: new Registry() }))
  const definition = new Test()
    .target(Registry, 'register')
    .effectful()
    .use(local)
    .from((ctx) => ctx.registry)
    .property('duplicate registration', (p) =>
      p
        .forAll(tuples(strings()), { seed: 9, runs: 4 })
        .steps((s) => {
          s.target.args(s.input[0])
          return s.target.final(s.input[0])
        })
        .expect((e) => [e.error.ofType(Duplicate).message.toEqual('duplicate')]),
    )
  expect((await library.run(definition)).status).toBe('passed')
  let calls = 0
  const earlyFailure = new Test()
    .target(() => {
      calls++
      throw new Duplicate('duplicate')
    })
    .property('prefix failure is not final failure', (p) =>
      p
        .forAll(tuples())
        .steps((s) => {
          s.target.args()
          return s.target.final()
        })
        .expect((e) => [e.error.ofType(Duplicate).message.toEqual('duplicate')]),
    )
  const result = await library.run(earlyFailure)
  expect(result.status).toBe('failed')
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  const evaluation = node.cases[0].attempts[0]?.evaluations?.[0]
  expect(evaluation?.expectedTermination).toBe('throw')
  expect(evaluation?.operations.map((operation) => operation.failureIndexes)).toEqual([[0], []])
  expect(calls).toBe(1)
})

test('pure scenario supports concrete round trips and generated relations', async () => {
  const library = await harness()
  const encode = (text: string) => new TextEncoder().encode(text)
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
  const definition = new Test()
    .target(scenario({ encode, decode }))
    .it('Japanese regression', (t) =>
      t.steps((s) => s.decode.args(s.encode.args('こんにちは'))).expect((e) => [e.result.toEqual('こんにちは')]),
    )
    .property('round trip', (p) =>
      p
        .forAll(tuples(strings()), { seed: 5, runs: 6 })
        .steps((s) => s.decode.args(s.encode.args(s.input[0])))
        .expect((e) => [
          e
            .on({ actual: e.result, original: e.sample(0) })
            .satisfies('original string', ({ actual, original }) => actual === original),
        ]),
    )
  expect((await library.run(definition)).status).toBe('passed')
})

test('scenario methods share the supplied environment and support final failure in it', async () => {
  const library = await harness()
  class Insufficient extends Error {}
  class Account {
    balance = 0
    deposit(amount: number) {
      this.balance += amount
      return this.balance
    }
    withdraw(amount: number) {
      if (amount > this.balance) throw new Insufficient('balance')
      this.balance -= amount
      return this.balance
    }
  }
  const local = environment(async (_, scope, next) => {
    const account = new Account()
    return next({ account, balance: scope.state({ evidence: 'real-effect', read: () => account.balance }) })
  })
  const definition = new Test()
    .target(scenario({ deposit: method(Account, 'deposit'), withdraw: method(Account, 'withdraw') }))
    .effectful()
    .use(local)
    .from((ctx) => ({ deposit: ctx.account, withdraw: ctx.account }))
    .it('reject overdraft after deposit', (t) =>
      t
        .steps((s) => {
          const credited = s.deposit.args(10)
          return { credited, rejected: s.withdraw.final(11) }
        })
        .expect((e) => [
          e.result.part('credited').toEqual(10),
          e.error.ofType(Insufficient).message.toEqual('balance'),
          e.state(e.ctx.balance).toEqual(10),
        ]),
    )
  const withProperty = definition.property('withdrawal outcome follows balance', (p) =>
    p
      .forAll(tuples(integers({ min: 0, max: 20 })), { seed: 8, runs: 12 })
      .steps((s) => ({ deposited: s.deposit.args(10), withdrawal: s.withdraw.final(s.input[0]) }))
      .expect((e) => [
        e.result.part('deposited').toEqual(10),
        e
          .on({ amount: e.sample(0), exit: e.outcome.withError(Insufficient), balance: e.state(e.ctx.balance) })
          .satisfies('balance and outcome', ({ amount, exit, balance }) =>
            amount <= 10
              ? exit.kind === 'return' && exit.value === 10 - amount && balance === 10 - amount
              : exit.kind === 'throw' && balance === 10,
          ),
      ]),
  )
  expect((await library.run(withProperty)).status).toBe('passed')
})

test('todo results retain case classification without creating evaluations', async () => {
  const library = await harness()
  const result = await library.run(
    new Test()
      .target(() => 1)
      .effectful()
      .todo('later'),
  )
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  expect(node.cases[0]).toMatchObject({ caseKind: 'todo', characteristic: 'effectful', notRun: 'todo', attempts: [] })
})

test('a timed-out target cannot run outcome projections or predicates after settling late', async () => {
  const library = await harness()
  let projections = 0,
    predicates = 0
  const definition = new Test()
    .target(async (): Promise<number> => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      throw new Error('late')
    })
    .property('timeout is not an expected throw', (p) =>
      p
        .timeout(5)
        .forAll(tuples())
        .expect((e) => [
          e
            .on(
              e.outcome.withError(Error, (error) => {
                projections++
                return error.message
              }),
            )
            .satisfies('known exit', () => {
              predicates++
              return true
            }),
        ]),
    )
  const result = await library.run(definition)
  expect(result.status).toBe('failed')
  expect([projections, predicates]).toEqual([0, 0])
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  expect(node.cases[0].attempts[0]?.assertions[0]?.status).toBe('not-evaluated')
  expect(node.cases[0].attempts[0]?.property?.counterexample).toBeNull()
})

test('sample refs preserve selection-time data before argsFrom transforms its candidate', async () => {
  const library = await harness()
  const input: { count: number } = { count: 1 }
  const definition = new Test()
    .target((value: { count: number }) => value.count)
    .property('bound input differs from selected sample', (p) =>
      p
        .forAll(tuples(constant(input)))
        .argsFrom((_, sample) => {
          sample[0].count = 2
          return [sample[0]]
        })
        .expect((e) => [
          e
            .on({ selected: e.sample(0).field('count'), bound: e.input(0).field('count'), result: e.result })
            .satisfies(
              'preserves the original sample',
              ({ selected, bound, result }) => selected === 1 && bound === 2 && result === 2,
            ),
        ]),
    )
  expect((await library.run(definition)).status).toBe('passed')
  expect(input.count).toBe(1)
})

test('input snapshots describe the arguments at invocation after observation setup', async () => {
  const library = await harness()
  const input = { n: 1 }
  const local = environment(async (_, scope, next) =>
    next({
      opened: scope.action<number>({
        evidence: 'real-effect',
        open: () => {
          input.n = 2
          return { finish: () => [], dispose: () => {} }
        },
      }),
      baseline: scope.state({ evidence: 'real-effect', read: (query: { n: number }) => query.n }),
    }),
  )
  const definition = new Test()
    .target((arg: { n: number }) => arg.n)
    .effectful()
    .use(local)
    .property('call input', (p) =>
      p
        .forAll(tuples())
        .argsFrom(() => [input])
        .expect((e) => [
          e.action(e.ctx.opened).untilTargetSettles().none(),
          e
            .on({ before: e.state(e.ctx.baseline, e.input(0)).before(), input: e.input(0), result: e.result })
            .satisfies(
              'snapshot at each observation point',
              ({ before, input, result }) => before === 1 && input.n === 2 && result === 2,
            ),
        ]),
    )
  const result = await library.run(definition)
  expect(result.status).toBe('passed')
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  const assertions = node.cases[0].attempts[0]?.assertions
  expect(assertions?.[1].assertion.observations).toMatchObject([
    {
      kind: 'state',
      timing: { kind: 'before' },
      args: [{ kind: 'object', properties: [{ key: { value: 'n' }, value: { kind: 'number', value: 1 } }] }],
    },
  ])
})

test('interrupting or failing cleanup during shrinking keeps the adopted evaluation at the top level', async () => {
  for (const mode of ['interrupt', 'cleanup-failure'] as const) {
    const library = await harness()
    const controller = new AbortController()
    let evaluations = 0
    const local = environment(async (_, _scope, next) => {
      evaluations++
      const result = await next({})
      if (evaluations === 2) {
        if (mode === 'interrupt') controller.abort()
        else throw new Error('candidate cleanup failed')
      }
      return result
    })
    const definition = new Test()
      .target((value: number) => value)
      .effectful()
      .use(local)
      .property('small', (p) =>
        p
          .forAll(tuples(integers({ min: 0, max: 100 })), { seed: 42 })
          .steps((s) => s.target.args(s.input[0]))
          .expect((e) => [e.on(e.result).satisfies('small', (value) => value < 5)]),
      )
    const result = await library.run(definition, { signal: controller.signal })
    const node = result.tests[0]
    expect.assert(node.kind === 'test')
    const attempt = node.cases[0].attempts[0]
    expect(attempt?.selectedEvaluationIndex).toBe(0)
    expect(attempt?.property?.stopped).toBe(mode === 'interrupt' ? 'interrupted' : 'execution-failed')
    expect(attempt?.outcome).toEqual(attempt?.evaluations?.[0].outcome)
    expect(attempt?.operations).toEqual(attempt?.evaluations?.[0].operations)
    expect(attempt?.assertions.map((assertion) => assertion.status)).toEqual(['failed'])
    expect(attempt?.assertions[0].failureIndexes).toEqual([0])
    expect(attempt?.evaluations).toHaveLength(2)
    if (mode === 'cleanup-failure') expect(attempt?.cleanup).toBe('incomplete')
  }
})
