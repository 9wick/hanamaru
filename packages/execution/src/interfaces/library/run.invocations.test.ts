import { createTestTarget } from '@zeltjs/testing/vitest'
import { LibraryRun } from './run.js'
import { ValueComparison } from '../../infrastructure/comparison.js'
import { LocalExecutor } from '../../infrastructure/execution/local.js'
import { expect, test } from 'vite-plus/test'
import { Test, middleware, relation, resource } from '../../../../../src/index.js'
import type { CallRef, ItDone, TestDefinition } from '../../../../../src/index.js'
import { buildCallPlan } from '../../../../blueprint/src/domain/definition/calls.js'
import { invoke, objectValue, property } from '../../domain/execution/javascript.js'
import type { Value } from '../../domain/execution/javascript.js'

const double = (value: number) => value * 2

function method(receiver: Value, key: string, ...args: Value[]): Value {
  return invoke(objectValue(property(receiver, key)), receiver, args)
}

test('relation awaits dependencies, leaves unused calls unexecuted and exposes the chosen result', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const log: string[] = []
  let definitions = 0
  const encode = async (value: string) => {
    log.push('encode')
    await Promise.resolve()
    return new TextEncoder().encode(value)
  }
  const decode = (bytes: Uint8Array) => {
    log.push('decode')
    return new TextDecoder().decode(bytes)
  }
  const suite = new Test().target('codec', relation({ encode, decode })).it('round trip', (t) =>
    t
      .calls((c) => {
        definitions++
        c.encode.args('unused')
        return c.decode.args(c.encode.args('こんにちは'))
      })
      .expect((e) => [e.result.toBe('こんにちは')]),
  )
  expect(log).toEqual([])
  expect(suite.blueprint().target.kind).toBe('relation')
  expect((await run(suite)).status).toBe('passed')
  expect(log).toEqual(['encode', 'decode'])
  expect((await run(suite)).status).toBe('passed')
  expect(definitions).toBe(1)
  expect(log).toEqual(['encode', 'decode', 'encode', 'decode'])
})

test('named results share descriptor identity and keep separately described calls separate', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  let count = 0
  const key = (a: string, b: string) => {
    count++
    return JSON.stringify([a, b])
  }
  const suite = new Test()
    .target(key)
    .it('keys', (t) =>
      t
        .calls((c) => {
          const first = c.args('ab', 'c')
          return { first, alias: first, sameArgs: c.args('ab', 'c'), second: c.args('a', 'bc') }
        })
        .expect((e) => [
          e.result.toSatisfy(
            ({ first, alias, sameArgs, second }) => first === alias && first === sameArgs && first !== second,
          ),
        ]),
    )
    .it('ordinary args', (t) => t.args('a', 'b').expect((e) => [e.result.toBe('["a","b"]')]))
  expect((await run(suite)).status).toBe('passed')
  expect(count).toBe(4)
})

test('a single function can depend on its earlier call, including an undefined result', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const seen: (number | undefined)[] = []
  const identity = (value: number | undefined) => {
    seen.push(value)
    return value
  }
  const suite = new Test()
    .target(identity)
    .it('undefined', (t) => t.calls((c) => c.args(c.args(undefined))).expect((e) => [e.result.toBe(undefined)]))
  expect((await run(suite)).status).toBe('passed')
  expect(seen).toEqual([undefined, undefined])
})

test('retry rebuilds all results inside the existing middleware, mock and call-observation scope', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const log: string[] = []
  const service = { read: () => 10 }
  let attempt = 0
  const compute = (n: number) => {
    log.push('target')
    return n + service.read()
  }
  const suite = new Test()
    .use(
      middleware(async (_, next) => {
        attempt++
        log.push('open')
        try {
          return await next()
        } finally {
          log.push('close')
        }
      }),
    )
    .target(compute)
    .it('retry', (t) =>
      t
        .retry(1)
        .mock(service, 'read', (m) => m.returns(1))
        .calls((c) => ({ first: c.args(1), second: c.args(2) }))
        .expect((e) => [e.result.toSatisfy(({ first, second }) => attempt === 2 && first === 2 && second === 3)])
        .expectCalls((call) => [call(service, 'read').calledTimes(2)]),
    )
  const result = await run(suite)
  expect(result.status).toBe('passed')
  expect(log).toEqual(['open', 'target', 'target', 'close', 'open', 'target', 'target', 'close'])
  expect(service.read()).toBe(10)
})

test('skip and todo never invoke targets, each provides data, and groups accept relation suites', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  let count = 0
  const subject = (n: number) => {
    count++
    return n
  }
  const suite = new Test()
    .target(relation({ subject }))
    .skip('skip', (t) => t.calls((c) => c.subject.args(0)).expect((e) => [e.result.toBe(0)]))
    .todo('todo')
    .each('rows', [1, 2], (t, n) => t.calls((c) => c.subject.args(n)).expect((e) => [e.result.toBe(n)]))
  const definition: TestDefinition = new Test().group([suite])
  expect((await run(definition)).status).toBe('passed')
  expect(count).toBe(2)
})

test.each(['throw', 'reject'])('an unexpected %s fails, identifies pending calls and skips expect', async (kind) => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  let decoded = 0,
    evaluated = 0,
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
    .target(relation({ encode, decode }))
    .it('failure', (t) =>
      t
        .calls((c) => c.decode.args(c.encode.args('broken')))
        .expect((e) => {
          evaluated++
          return [e.result.toBe(1)]
        }),
    )
  const result = await run(suite)
  expect(result.status).toBe('failed')
  expect(decoded).toBe(0)
  expect(evaluated).toBe(0)
  expect(cleaned).toBe(1)
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  expect(node.cases[0].attempts[0]?.failures[0]?.message).toMatch(/call encode #1 failed; not run: decode #2/)
  expect(node.cases[0].attempts[0]?.failures[0]?.phase).toBe('target')
  expect(JSON.stringify(result)).toContain('broken')
})

test('timeout stops dependent calls and retry after the running target settles', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

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
  const suite = new Test().target(relation({ first, second })).it('timeout', (t) =>
    t
      .timeout(5)
      .retry(2)
      .calls((c) => c.second.args(c.first.args(2)))
      .expect((e) => [e.result.toBe(4)]),
  )
  expect((await run(suite)).status).toBe('failed')
  expect(calls).toBe(1)
  expect(dependent).toBe(0)
})

test('method calls preserve this, share ordinary values and observe calls across the plan', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const object = {
    base: 3,
    read(n: number) {
      return this.base + n
    },
  }
  const suite = new Test().target(object, 'read').it('method', (t) =>
    t
      .calls((c) => ({ first: c.args(1), second: c.args(2) }))
      .expectCalls((call) => [call(object, 'read').calledTimes(2)])
      .expect((e) => [e.result.toEqual({ first: 4, second: 5 })]),
  )
  expect((await run(suite)).status).toBe('passed')
  const shared = { value: 0 }
  const increment = (data: typeof shared) => {
    data.value++
    return data
  }
  const values = new Test()
    .target(increment)
    .it('shared', (t) =>
      t.calls((c) => c.args(c.args(shared))).expect((e) => [e.result.toBe(shared), e.result.toEqual({ value: 2 })]),
    )
  expect((await run(values)).status).toBe('passed')
  expect(shared.value).toBe(2)
})

test('relation snapshots participants, preserves arbitrary names and can be reused from a blueprint', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const members = { ['__proto__']: double, constructor: double }
  const subject = relation(members)
  members.constructor = (n: number) => n + 100
  const suite = new Test()
    .target(subject)
    .it('names', (t) =>
      t
        .calls((c) => ({ constructor: c.constructor.args(1), ['__proto__']: c.__proto__.args(2) }))
        .expect((e) => [e.result.toEqual({ constructor: 2, ['__proto__']: 4 })]),
    )
  expect((await run(suite)).status).toBe('passed')
  const repeated = new Test()
    .target(suite.blueprint().target)
    .it('reuse', (t) => t.calls((c) => c.constructor.args(2)).expect((e) => [e.result.toBe(4)]))
  expect((await run(repeated)).status).toBe('passed')
})

test.each(['then', 'constructor', '__proto__'])('named result %s remains an ordinary result record', async (name) => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const fn = () => 1
  const suite = new Test()
    .target(() => fn)
    .it('then key', (t) =>
      t.calls((c) => ({ [name]: c.args() })).expect((e) => [e.result.toSatisfy((result) => result[name] === fn)]),
    )
  expect((await run(suite)).status).toBe('passed')
})

test('case resource and middleware fields retain their types and cleanup around calls', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

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
    .target(relation({ double }))
    .use(middleware(async (_, next) => next({ input: 2 })))
    .it('context', (t) =>
      t
        .require(fixture)
        .calls((c) => c.double.args(2))
        .expect((e) => [e.result.toBe(e.ctx.expected), e.result.toBe(e.ctx.input * 2)]),
    )
  expect((await run(suite)).status).toBe('passed')
  expect(log).toEqual(['setup', 'cleanup'])
})

test('call definitions reject foreign references, invalid outputs and builders used after definition', () => {
  let foreign: CallRef<number> | undefined
  new Test().target(double).it('first', (t) =>
    t
      .calls((c) => {
        foreign = c.args(1)
        return foreign
      })
      .expect((e) => [e.result.toBe(2)]),
  )
  expect.assert(foreign !== undefined)
  const ref = foreign
  expect(() =>
    new Test().target(double).it('other', (t) => t.calls((c) => c.args(ref)).expect((e) => [e.result.toBe(4)])),
  ).toThrow(/another calls definition/)
  for (const output of [{}, [], { result: 1 }, Promise.resolve(1), 1]) {
    expect(() => buildCallPlan({ kind: 'function', fn: double }, () => output)).toThrow()
  }
  let saved: object | undefined
  buildCallPlan({ kind: 'function', fn: double }, (c: object) => {
    saved = c
    return method(c, 'args', 1)
  })
  expect(() => method(saved, 'args', 2)).toThrow(/only available inside/)
})

test('args and calls exclude each other even if callers bypass the type system', () => {
  expect(() =>
    new Test().target(double).it('mixed', (t) => {
      const args = t.args(1)
      method(args, 'calls', () => undefined)
      return args.expect((e) => [e.result.toBe(2)])
    }),
  ).toThrow(/mutually exclusive/)
  expect(() =>
    new Test().target(double).it('mixed', (t) => {
      const calls = t.calls((c) => c.args(1))
      method(calls, 'args', 1)
      return calls.expect((e) => [e.result.toBe(2)])
    }),
  ).toThrow(/mutually exclusive/)
  expect(() =>
    new Test().target(relation({ double })).it('args', (t) => {
      method(t, 'args', 1)
      return t.calls((c) => c.double.args(1)).expect((e) => [e.result.toBe(2)])
    }),
  ).toThrow(/relation cases require calls/)
})

test('a completed calls definition cannot be moved to a different target', () => {
  let completed: ItDone | undefined
  new Test().target(double).it('original', (t) => {
    completed = t.calls((c) => c.args(1)).expect((e) => [e.result.toBe(2)])
    return completed
  })
  expect.assert(completed !== undefined)
  const foreign = completed
  expect(() => new Test().target((n: number) => n + 100).it('foreign', () => foreign)).toThrow(/another target/)
})
