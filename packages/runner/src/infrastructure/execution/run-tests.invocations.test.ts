import { onTest } from '@zeltjs/testing/vitest'
import { createApp } from '@zeltjs/core'
import { override } from '@zeltjs/core/internal-bridge/testing'
import { expect, test } from 'vite-plus/test'
import {
  Test,
  middleware,
  environment,
  scenario,
  method,
  resource,
  tuples,
  constant,
} from '../../../../../src/index.js'
import type { ItDone, TestDefinition } from '../../../../../src/index.js'
import { WorkerExecutionLauncher } from '../workers/client.js'
import { InlineRunHarness, LocalExecutor } from '../../testing/inline-execution.test.js'
import { compileSteps, ObservationOwner } from '@hanamaru/blueprint/model'
import { invoke, objectValue, property } from '../../domain/execution/javascript.js'
import type { Value } from '../../domain/execution/javascript.js'

async function harness() {
  const scope = await onTest(createApp([]))
  override(scope, [{ provide: WorkerExecutionLauncher, useValue: await scope.get(LocalExecutor) }])
  return scope.get(InlineRunHarness)
}
const double = (value: number) => value * 2
function call(receiver: Value, key: string, ...args: Value[]): Value {
  return invoke(objectValue(property(receiver, key)), receiver, args)
}

test('scenario awaits dependencies and executes even operations omitted from its result', async () => {
  const library = await harness()
  const log: string[] = []
  let compiled = 0
  const encode = async (value: string) => {
    log.push('encode')
    await Promise.resolve()
    return new TextEncoder().encode(value)
  }
  const decode = (bytes: Uint8Array) => {
    log.push('decode')
    return new TextDecoder().decode(bytes)
  }
  const suite = new Test().target('codec', scenario({ encode, decode })).it('round trip', (t) =>
    t
      .steps((s) => {
        compiled++
        s.encode.args('discarded result')
        return s.decode.args(s.encode.args('こんにちは'))
      })
      .expect((e) => [e.result.toEqual('こんにちは')]),
  )
  expect(log).toEqual([])
  expect(compiled).toBe(0)
  expect((await library.run(suite)).status).toBe('passed')
  expect((await library.run(suite)).status).toBe('passed')
  expect(compiled).toBe(2)
  expect(log).toEqual(['encode', 'encode', 'decode', 'encode', 'encode', 'decode'])
})

test('named aliases do not repeat an operation while separately declared operations do', async () => {
  const library = await harness()
  let count = 0
  const key = (a: string, b: string) => {
    count++
    return JSON.stringify([a, b])
  }
  const suite = new Test()
    .target(key)
    .property('key relation', (p) =>
      p
        .forAll(tuples(constant('ab'), constant('c')))
        .steps((s) => {
          const first = s.target.args(s.input[0], s.input[1])
          return { first, alias: first, sameArgs: s.target.args('ab', 'c'), second: s.target.args('a', 'bc') }
        })
        .expect((e) => [
          e
            .on(e.result)
            .satisfies(
              'same pair same key',
              ({ first, alias, sameArgs, second }) => first === alias && first === sameArgs && first !== second,
            ),
        ]),
    )
    .it('ordinary args', (t) => t.args('a', 'b').expect((e) => [e.result.toEqual('["a","b"]')]))
  expect((await library.run(suite)).status).toBe('passed')
  expect(count).toBe(4)
})

test('an undefined normal result can be the next operation argument', async () => {
  const library = await harness()
  const seen: (number | undefined)[] = []
  const identity = (value: number | undefined) => {
    seen.push(value)
    return value
  }
  const suite = new Test()
    .target(scenario({ identity }))
    .it('undefined', (t) =>
      t.steps((s) => s.identity.args(s.identity.args(undefined))).expect((e) => [e.result.toEqual(undefined)]),
    )
  expect((await library.run(suite)).status).toBe('passed')
  expect(seen).toEqual([undefined, undefined])
})

test('retry prepares and cleans the environment around the complete operation plan', async () => {
  const library = await harness()
  const log: string[] = []
  let attempt = 0
  const local = environment(async (_, scope, next) => {
    const offset = attempt++
    const outputs: number[] = []
    log.push('open')
    try {
      return await next({ offset, outputs, stored: scope.state({ evidence: 'real-effect', read: () => outputs }) })
    } finally {
      log.push('close')
    }
  })
  const compute = (n: number, offset: number, outputs: number[]) => {
    log.push('target')
    outputs.push(n + offset)
    return n + offset
  }
  const suite = new Test()
    .target(scenario({ compute }))
    .effectful()
    .use(local)
    .it('retry', (t) =>
      t
        .retry(1)
        .steps((s) => ({
          first: s.compute.args(1, s.ctx.offset, s.ctx.outputs),
          second: s.compute.args(2, s.ctx.offset, s.ctx.outputs),
        }))
        .expect((e) => [e.result.toEqual({ first: 2, second: 3 }), e.state(e.ctx.stored).toEqual([2, 3])]),
    )
  expect((await library.run(suite)).status).toBe('passed')
  expect(log).toEqual(['open', 'target', 'target', 'close', 'open', 'target', 'target', 'close'])
})

test('skip and todo do not compile or invoke operations and groups accept scenarios', async () => {
  const library = await harness()
  let count = 0,
    skipped = 0
  const subject = (n: number) => {
    count++
    return n
  }
  const suite = new Test()
    .target(scenario({ subject }))
    .skip('skip', (t) =>
      t
        .steps((s) => {
          skipped++
          return s.subject.args(0)
        })
        .expect((e) => [e.result.toEqual(0)]),
    )
    .todo('todo')
    .it('one', (t) => t.steps((s) => s.subject.args(1)).expect((e) => [e.result.toEqual(1)]))
    .it('two', (t) => t.steps((s) => s.subject.args(2)).expect((e) => [e.result.toEqual(2)]))
  const definition: TestDefinition = new Test().group([suite])
  expect((await library.run(definition)).status).toBe('passed')
  expect(count).toBe(2)
  expect(skipped).toBe(0)
})

test.each(['throw', 'reject'])('unexpected %s stops later operations and preserves cleanup', async (kind) => {
  const library = await harness()
  let decoded = 0,
    compiled = 0,
    cleaned = 0
  const encode = (value: string): Uint8Array | Promise<Uint8Array> => {
    if (kind === 'reject') return Promise.reject(new Error(value))
    throw new Error(value)
  }
  const decode = (bytes: Uint8Array) => {
    decoded++
    return bytes.length
  }
  const suite = new Test()
    .use(
      middleware(async (_, next) => {
        try {
          return await next()
        } finally {
          cleaned++
        }
      }),
    )
    .target(scenario({ encode, decode }))
    .it('failure', (t) =>
      t
        .steps((s) => s.decode.args(s.encode.args('broken')))
        .expect((e) => {
          compiled++
          return [e.result.toEqual(1)]
        }),
    )
  const result = await library.run(suite)
  expect(result.status).toBe('failed')
  expect(decoded).toBe(0)
  expect(compiled).toBe(1)
  expect(cleaned).toBe(1)
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  expect(node.cases[0].attempts[0]?.failures[0]).toMatchObject({ kind: 'outcome', phase: 'target', operationIndex: 0 })
  expect(node.cases[0].attempts[0]?.assertions[0]?.status).toBe('not-evaluated')
  expect(JSON.stringify(result)).toContain('broken')
})

test('timeout stops dependent operations and retry after the running target settles', async () => {
  const library = await harness()
  let calls = 0,
    dependent = 0
  const first = async (n: number) => {
    calls++
    await new Promise((resolve) => setTimeout(resolve, 25))
    return n
  }
  const second = (n: number) => {
    dependent++
    return double(n)
  }
  const suite = new Test().target(scenario({ first, second })).it('timeout', (t) =>
    t
      .timeout(5)
      .retry(2)
      .steps((s) => s.second.args(s.first.args(2)))
      .expect((e) => [e.result.toEqual(4)]),
  )
  expect((await library.run(suite)).status).toBe('failed')
  expect(calls).toBe(1)
  expect(dependent).toBe(0)
})

test('scenario methods preserve this and dependency arguments preserve live identity', async () => {
  const library = await harness()
  class Service {
    base = 3
    read(n: number) {
      return this.base + n
    }
  }
  const suite = new Test()
    .target(scenario({ read: method(Service, 'read') }))
    .from(() => ({ read: new Service() }))
    .it('method', (t) =>
      t
        .steps((s) => ({ first: s.read.args(1), second: s.read.args(2) }))
        .expect((e) => [e.result.toEqual({ first: 4, second: 5 })]),
    )
  expect((await library.run(suite)).status).toBe('passed')
  const shared = { value: 0 }
  const increment = (data: typeof shared) => {
    data.value++
    return data
  }
  const values = new Test()
    .target(scenario({ increment }))
    .effectful()
    .it('shared', (t) =>
      t
        .steps((s) => s.increment.args(s.increment.args(shared)))
        .expect((e) => [e.result.toBe(shared), e.result.toEqual({ value: 2 })]),
    )
  expect((await library.run(values)).status).toBe('passed')
  expect(shared.value).toBe(2)
})

test('scenario snapshots participants and preserves nonreserved member names', async () => {
  const library = await harness()
  const members = { ['__proto__']: double, constructor: double }
  const subject = scenario(members)
  members.constructor = (n: number) => n + 100
  const suite = new Test()
    .target(subject)
    .it('names', (t) =>
      t
        .steps((s) => ({ constructor: s.constructor.args(1), ['__proto__']: s.__proto__.args(2) }))
        .expect((e) => [e.result.toEqual({ constructor: 2, ['__proto__']: 4 })]),
    )
  expect((await library.run(suite)).status).toBe('passed')
})

test.each(['then', 'constructor', '__proto__'])('named result %s is not assimilated as a promise', async (name) => {
  const library = await harness()
  const fn = () => 1
  const suite = new Test()
    .target(scenario({ produce: () => fn }))
    .it('named function', (t) =>
      t.steps((s) => ({ [name]: s.produce.args() })).expect((e) => [e.result.part(name).toBe(fn)]),
    )
  expect((await library.run(suite)).status).toBe('passed')
})

test('resource and middleware fields are available during steps and cleanup surrounds the case', async () => {
  const library = await harness()
  const log: string[] = []
  const fixture = resource({
    scope: 'perWorker',
    async setup(_, next) {
      log.push('setup')
      try {
        return await next({ expected: 4 })
      } finally {
        log.push('cleanup')
      }
    },
  })
  const suite = new Test()
    .require(fixture)
    .target(scenario({ double }))
    .use(middleware(async (_, next) => next({ input: 2 })))
    .it('context', (t) => t.steps((s) => s.double.args(s.ctx.input)).expect((e) => [e.result.toEqual(e.ctx.expected)]))
  expect((await library.run(suite)).status).toBe('passed')
  expect(log).toEqual(['setup', 'cleanup'])
})

test('step compilation rejects invalid outputs and builders used after compilation', () => {
  for (const output of [{}, [], { result: 1 }, Promise.resolve(1), 1])
    expect(() => compileSteps(new ObservationOwner(), ['target'], () => output, {}, null)).toThrow()
  let saved: object | undefined
  compileSteps(
    new ObservationOwner(),
    ['target'],
    (s: object) => {
      saved = objectValue(property(s, 'target'))
      return call(saved, 'args', 1)
    },
    {},
    null,
  )
  expect(() => call(saved, 'args', 2)).toThrow('only available during compile')
})

test('a completed case cannot be moved to a different target', () => {
  let completed: ItDone | undefined
  new Test().target(double).it('original', (t) => {
    completed = t.args(1).expect((e) => [e.result.toEqual(2)])
    return completed
  })
  expect.assert(completed !== undefined)
  const foreign = completed
  expect(() => new Test().target((n: number) => n + 100).it('foreign', () => foreign)).toThrow('another target')
})

test('operation diagnostics retain prefix outcomes and the unexecuted final target', async () => {
  const library = await harness()
  const first = (): number => {
    throw new Error('prefix failed')
  }
  const last = () => 1
  const definition = new Test().target(scenario({ first, last })).it('stops before final', (t) =>
    t
      .steps((s) => {
        s.first.args()
        return s.last.final()
      })
      .expect((e) => [e.error.message.toEqual('prefix failed')]),
  )
  const result = await library.run(definition)
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  const attempt = node.cases[0].attempts[0]
  expect(attempt?.terminationTarget).toBe(1)
  expect(attempt?.operations).toMatchObject([
    { index: 0, key: 'first', mode: 'return-required', status: 'threw' },
    { index: 1, key: 'last', mode: 'final', status: 'not-run' },
  ])
  expect(attempt?.evaluations?.[0]).toMatchObject({
    kind: 'example',
    sampleIndex: null,
    terminationTarget: 1,
    failureIndexes: [0],
  })
})

test('named operation result expectations retain their field path and operation index', async () => {
  const library = await harness()
  const definition = new Test()
    .target(scenario({ double }))
    .it('named mismatch', (t) =>
      t
        .steps((s) => ({ first: s.double.args(2), second: s.double.args(3) }))
        .expect((e) => [e.result.part('first').toEqual(99)]),
    )
  const result = await library.run(definition)
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  expect(node.cases[0].attempts[0]?.assertions[0]?.assertion).toMatchObject({ path: ['first'], operationIndex: 0 })
})
