import test from 'node:test'
import assert from 'node:assert/strict'
import { Test, middleware, run } from '../src/index.js'

const add = (a, b) => a + b

test('basic test and blueprint do not run target during definition', async () => {
  let calls = 0
  const subject = (value) => {
    calls++
    return value * 2
  }
  const suite = new Test().target(subject).it('double', (t) => t.args(2).expect((e) => [e.result.toBe(4)]))
  const bp = suite.blueprint()
  assert.equal(calls, 0)
  assert.equal(bp.kind, 'test')
  assert.equal(bp.cases[0].origin.line > 0, true)
  const result = await run(suite)
  assert.equal(result.status, 'passed')
  assert.equal(result.tests[0].cases[0].attempts[0].status, 'passed')
  assert.equal(calls, 1)
})

test('same child reads values from attempt or group provider', async () => {
  const log = []
  const child = new Test()
    .target(add)
    .it('seed', (t) => t.argsFrom((ctx) => [ctx.seed, 1]).expect((e) => [e.result.toBe(3)]))
  const provider = middleware(async (_, next) => {
    log.push('open')
    try {
      return await next({ seed: 2 })
    } finally {
      log.push('close')
    }
  })
  const attemptParent = new Test().use(provider).group([child])
  const groupParent = new Test().group(provider, [child])
  assert.equal((await run(attemptParent)).status, 'passed')
  assert.deepEqual(log, ['open', 'close'])
  log.length = 0
  assert.equal((await run(groupParent)).status, 'passed')
  assert.deepEqual(log, ['open', 'close'])
})

test('group provider runs once across children, attempt middleware runs each attempt', async () => {
  const log = []
  const rootUse = middleware(async (_, next) => {
    log.push('use+')
    try {
      return await next({ seed: 100 })
    } finally {
      log.push('use-')
    }
  })
  const group = middleware(async (_, next) => {
    log.push('group+')
    try {
      return await next({ seed: 2 })
    } finally {
      log.push('group-')
    }
  })
  const child = new Test()
    .target(add)
    .it('a', (t) => t.argsFrom((ctx) => [ctx.seed, 1]).expect((e) => [e.result.toBe(3)]))
    .it('b', (t) => t.argsFrom((ctx) => [ctx.seed, 2]).expect((e) => [e.result.toBe(4)]))
  const result = await run(new Test().use(rootUse).group(group, [child]))
  assert.equal(result.status, 'passed')
  assert.deepEqual(log, ['group+', 'use+', 'use-', 'use+', 'use-', 'group-'])
})

test('group middleware prethrow fails run and cancels children', async () => {
  const child = new Test().target(add).it('never', (t) => t.args(1, 2).expect((e) => [e.result.toBe(3)]))
  const broken = middleware(async () => {
    throw new Error('open failed')
  })
  const result = await run(new Test().group(broken, [child]))
  assert.equal(result.status, 'failed')
  assert.equal(result.reason, 'completed')
  assert.equal(result.tests[0].middleware.status, 'failed')
  assert.equal(result.tests[0].children[0].result.cases[0].notRun, 'cancelled')
})

test('retry records failures before success', async () => {
  let calls = 0
  const suite = new Test()
    .retry(1)
    .target(() => ++calls)
    .it('retry', (t) => t.args().expect((e) => [e.result.toBe(2)]))
  const result = await run(suite)
  assert.equal(result.status, 'passed')
  assert.deepEqual(
    result.tests[0].cases[0].attempts.map((x) => x.status),
    ['failed', 'passed'],
  )
  assert.equal(
    (await run(new Test().target(add).it('ordinary', (t) => t.args(1, 2).expect((e) => [e.result.toBe(3)])))).status,
    'passed',
  )
})

test('mock and call records use one wrapper and restore the original method', async () => {
  const service = {
    read(value) {
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
  assert.equal(result.status, 'passed')
  assert.deepEqual(Object.getOwnPropertyDescriptor(service, 'read'), original)
  assert.equal(service.read(3), 6)
})

test('call records can observe the real method without a mock', async () => {
  const service = {
    read(value) {
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
  assert.equal((await run(suite)).status, 'passed')
  assert.equal(service.read(3), 6)
})

test('expected thrown target error passes; unexpected error fails', async () => {
  const suite = new Test()
    .target(() => {
      throw new Error('boom')
    })
    .it('expected', (t) => t.args().expect((e) => [e.error.toThrow('boom')]))
  assert.equal((await run(suite)).status, 'passed')
  const unexpected = new Test()
    .target(() => {
      throw new Error('boom')
    })
    .it('unexpected', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  const result = await run(unexpected)
  assert.equal(result.status, 'failed')
  assert.equal(result.tests[0].cases[0].attempts[0].failures[0].kind, 'outcome')
})

test('only, skip and todo leave no attempts', async () => {
  const suite = new Test()
    .target(add)
    .it('normal', (t) => t.args(1, 2).expect((e) => [e.result.toBe(3)]))
    .only('exclusive', (t) => t.args(2, 2).expect((e) => [e.result.toBe(4)]))
    .skip('disabled', (t) => t.args(1, 1).expect((e) => [e.result.toBe(2)]))
    .todo('later')
  const result = await run(suite)
  assert.deepEqual(
    result.tests[0].cases.map((x) => x.notRun),
    ['skipped', undefined, 'skipped', 'todo'],
  )
  await assert.rejects(run(suite, { forbidOnly: true }), /only is forbidden/)
})

test('group failure after next interrupts later roots', async () => {
  const child = new Test().target(add).it('first', (t) => t.args(1, 2).expect((e) => [e.result.toBe(3)]))
  const later = new Test().target(add).it('later', (t) => t.args(1, 2).expect((e) => [e.result.toBe(3)]))
  const broken = middleware(async (_, next) => {
    await next()
    throw new Error('close failed')
  })
  const result = await run([new Test().group(broken, [child]), later])
  assert.equal(result.status, 'failed')
  assert.equal(result.reason, 'cleanup-failed')
  assert.equal(result.tests[1].cases[0].notRun, 'cancelled')
})

test('filter preserves original paths and rejects empty selection', async () => {
  const suite = new Test()
    .target(add)
    .it('first', (t) => t.args(1, 1).expect((e) => [e.result.toBe(2)]))
    .it('second', (t) => t.args(2, 2).expect((e) => [e.result.toBe(4)]))
  const result = await run(suite, { filter: 'second' })
  assert.deepEqual(
    result.tests[0].cases.map((x) => x.path),
    [[0, 1]],
  )
  await assert.rejects(run(suite, { filter: 'missing' }), /filter matched no cases/)
})

test('same group definition can be reused with independent paths', async () => {
  const child = new Test().target(add).it('one', (t) => t.args(1, 2).expect((e) => [e.result.toBe(3)]))
  const group = new Test().group([child])
  const result = await run(new Test().group([group, group]))
  assert.deepEqual(
    result.tests[0].children.map((x) => x.result.path),
    [
      [0, 0],
      [0, 1],
    ],
  )
  assert.equal(result.status, 'passed')
})

test('runtime rejects concurrent runs and empty input', async () => {
  const suite = new Test()
    .target(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return 1
    })
    .it('slow', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  const ongoing = run(suite)
  await assert.rejects(run(suite), /already active/)
  assert.equal((await ongoing).status, 'passed')
  await assert.rejects(run([]), /requires completed/)
})

test('middleware contract errors do not retry', async () => {
  let entries = 0
  const broken = middleware(async () => {
    entries++
    return { anything: true }
  })
  const suite = new Test()
    .retry(2)
    .use(broken)
    .target(add)
    .it('unreached', (t) => t.args(1, 2).expect((e) => [e.result.toBe(3)]))
  const result = await run(suite)
  assert.equal(result.status, 'failed')
  assert.equal(entries, 1)
  assert.equal(result.tests[0].cases[0].attempts.length, 1)
})

test('instrumentation restores methods after assertion failure', async () => {
  const service = {
    read(value) {
      return value * 2
    },
  }
  const original = Object.getOwnPropertyDescriptor(service, 'read')
  const suite = new Test()
    .mock(service, 'read', (m) => m.returns(7))
    .target(() => service.read(1))
    .it('fail', (t) => t.args().expect((e) => [e.result.toBe(9)]))
  assert.equal((await run(suite)).status, 'failed')
  assert.deepEqual(Object.getOwnPropertyDescriptor(service, 'read'), original)
})

test('cleanup failure preserves the error that preceded it', async () => {
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
  const attempt = result.tests[0].cases[0].attempts[0]
  assert.equal(result.status, 'failed')
  assert.equal(attempt.cleanup, 'incomplete')
  assert.equal(attempt.failures.length, 2)
  assert.match(attempt.failures[0].message, /args failed/)
})

test('middleware timeout stops following cases', async () => {
  const slow = middleware(
    async (_, next) => {
      await new Promise((resolve) => setTimeout(resolve, 12))
      return next()
    },
    { timeout: 2 },
  )
  const suite = new Test()
    .use(slow)
    .target(add)
    .it('first', (t) => t.args(1, 2).expect((e) => [e.result.toBe(3)]))
    .it('second', (t) => t.args(1, 2).expect((e) => [e.result.toBe(3)]))
  const result = await run(suite)
  assert.equal(result.status, 'failed')
  assert.equal(result.reason, 'timeout')
  assert.equal(
    result.tests[0].cases[0].attempts[0].failures.some((x) => x.kind === 'timeout'),
    true,
  )
  assert.equal(result.tests[0].cases[1].notRun, 'cancelled')
})

test('deep equality handles cycles, missing fields and array holes', async () => {
  const left = { value: 1 }
  left.self = left
  const right = { value: 1 }
  right.self = right
  const suite = new Test().target(() => left).it('cycle', (t) => t.args().expect((e) => [e.result.toEqual(right)]))
  assert.equal((await run(suite)).status, 'passed')
  const sparse = []
  sparse.length = 1
  const dense = [undefined]
  const mismatch = new Test().target(() => sparse).it('hole', (t) => t.args().expect((e) => [e.result.toEqual(dense)]))
  assert.equal((await run(mismatch)).status, 'failed')
})

test('diagnostics never invoke getters', async () => {
  let invoked = 0
  const object = Object.defineProperty({}, 'danger', {
    enumerable: true,
    get() {
      invoked++
      throw new Error('getter')
    },
  })
  const suite = new Test().target(() => object).it('object', (t) => t.args().expect((e) => [e.result.toBe({})]))
  const result = await run(suite)
  assert.equal(result.status, 'failed')
  assert.equal(invoked, 0)
})

test('abort marks active and pending cases cancelled', async () => {
  const controller = new AbortController()
  const suite = new Test()
    .target(async () => {
      controller.abort()
      return 1
    })
    .it('active', (t) => t.args().expect((e) => [e.result.toBe(1)]))
    .it('pending', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  const result = await run(suite, { signal: controller.signal })
  assert.equal(result.status, 'cancelled')
  assert.equal(result.reason, 'interrupted')
  assert.equal(result.tests[0].cases[0].attempts[0].status, 'cancelled')
  assert.equal(result.tests[0].cases[1].notRun, 'cancelled')
})

test('a failed child inside an ordinary group returns a failed result', async () => {
  const child = new Test().target(add).it('wrong sum', (t) => t.args(1, 2).expect((e) => [e.result.toBe(4)]))
  const result = await run(new Test().group([child]))
  assert.equal(result.status, 'failed')
  assert.equal(result.tests[0].children[0].result.cases[0].attempts[0].status, 'failed')
})

test('a failed child does not become a group middleware failure', async () => {
  const child = new Test().target(add).it('wrong sum', (t) => t.args(1, 2).expect((e) => [e.result.toBe(4)]))
  const wrapper = middleware(async (_, next) => {
    try {
      return await next()
    } finally {
    }
  })
  const result = await run(new Test().group(wrapper, [child]))
  assert.equal(result.status, 'failed')
  assert.equal(result.tests[0].middleware.status, 'passed')
})

test('nonconfigurable writable methods can be observed and restored', async () => {
  const service = {}
  const original = (value) => value + 1
  Object.defineProperty(service, 'read', { value: original, configurable: false, writable: true })
  const suite = new Test()
    .target(() => service.read(2))
    .it('read', (t) =>
      t
        .args()
        .expect((e) => [e.result.toBe(3)])
        .expectCalls((call) => [call(service, 'read').calledOnceWith(2)]),
    )
  assert.equal((await run(suite)).status, 'passed')
  assert.equal(service.read, original)
})

test('calls made while building expectations are not part of the target call record', async () => {
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
  assert.equal((await run(suite)).status, 'passed')
})

test('group middleware reads stable group context before attempt values', async () => {
  const rootAttempt = middleware(async (_, next) => next({ seed: 100 }))
  const outerGroup = middleware(async (_, next) => next({ seed: 2 }))
  const innerGroup = middleware(async (ctx, next) => next({ expected: ctx.seed }))
  const child = new Test()
    .target((value) => value)
    .it('sees stable value', (t) => t.argsFrom((ctx) => [ctx.seed]).expect((e) => [e.result.toBe(e.ctx.expected)]))
  const result = await run(new Test().use(rootAttempt).group(outerGroup, [new Test().group(innerGroup, [child])]))
  assert.equal(result.status, 'passed')
})

test('contexts are readonly containers and null-prototype fields are accepted', async () => {
  const fields = Object.assign(Object.create(null), { answer: 42 })
  const suite = new Test()
    .use(
      middleware(async (ctx, next) => {
        assert.equal(Object.isFrozen(ctx), true)
        return next(fields)
      }),
    )
    .target((value) => value)
    .it('answer', (t) =>
      t
        .argsFrom((ctx) => {
          assert.equal(Object.isFrozen(ctx), true)
          return [ctx.answer]
        })
        .expect((e) => [e.result.toBe(42)]),
    )
  assert.equal((await run(suite)).status, 'passed')
})

test('predicate exceptions are failed assertions with execution causes', async () => {
  const suite = new Test()
    .target(() => 1)
    .it('throws', (t) =>
      t.args().expect((e) => [
        e.result.toSatisfy(() => {
          throw new Error('predicate')
        }),
      ]),
    )
  const result = await run(suite)
  const attempt = result.tests[0].cases[0].attempts[0]
  assert.equal(attempt.assertions[0].status, 'failed')
  assert.equal(attempt.failures[0].kind, 'execution')
})

test('Error diagnostics include message and never call accessors', async () => {
  let reads = 0
  const error = new Error('details')
  Object.defineProperty(error, 'other', {
    enumerable: true,
    get() {
      reads++
      return 1
    },
  })
  const suite = new Test()
    .target(() => {
      throw error
    })
    .it('error', (t) => t.args().expect((e) => [e.error.toThrow('details')]))
  const result = await run(suite)
  const properties = result.tests[0].cases[0].attempts[0].outcome.value.properties
  assert.equal(
    properties.some((p) => p.key.value === 'message' && p.value.value === 'details'),
    true,
  )
  assert.equal(
    properties.some((p) => p.key.value === 'other' && p.value.kind === 'accessor'),
    true,
  )
  assert.equal(reads, 0)
})

test('attempt middleware postprocessing failure aborts later cases', async () => {
  const broken = middleware(async (_, next) => {
    await next()
    throw new Error('after failed')
  })
  const suite = new Test()
    .use(broken)
    .target(() => 1)
    .it('first', (t) => t.args().expect((e) => [e.result.toBe(1)]))
    .it('later', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  const result = await run(suite)
  assert.equal(result.status, 'failed')
  assert.equal(result.reason, 'cleanup-failed')
  assert.equal(result.tests[0].cases[0].attempts[0].cleanup, 'incomplete')
  assert.equal(result.tests[0].cases[1].notRun, 'cancelled')
})

test('group middleware postprocessing failure reports incomplete cleanup', async () => {
  const broken = middleware(async (_, next) => {
    await next()
    throw new Error('after failed')
  })
  const child = new Test().target(() => 1).it('first', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  const result = await run(new Test().group(broken, [child]))
  assert.equal(result.reason, 'cleanup-failed')
  assert.equal(result.tests[0].middleware.cleanup, 'incomplete')
})

test('diagnostics use built-in accessors for special objects', async () => {
  let reads = 0
  class StrangeDate extends Date {
    getTime() {
      reads++
      throw new Error('override')
    }
  }
  class StrangeRegExp extends RegExp {
    get global() {
      reads++
      throw new Error('override')
    }
  }
  class StrangeMap extends Map {
    [Symbol.iterator]() {
      reads++
      throw new Error('override')
    }
  }
  const suite = new Test()
    .target(() => [new StrangeDate('2020-01-01'), new StrangeRegExp('a', 'g'), new StrangeMap([[1, 2]])])
    .it('special', (t) => t.args().expect((e) => [e.result.toBe([])]))
  const result = await run(suite)
  assert.equal(result.status, 'failed')
  assert.equal(reads, 0)
  assert.deepEqual(
    result.tests[0].cases[0].attempts[0].outcome.value.items.map((x) => x.kind),
    ['date', 'regexp', 'map'],
  )
})
