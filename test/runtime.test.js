import test from 'node:test'
import assert from 'node:assert/strict'
import { Test, middleware, run } from '../dist/index.js'

const add = (a, b) => a + b

function assertNotRun(result, reason) {
  assert.equal(result.notRun, reason)
  assert.deepEqual(result.attempts, [])
  assert.equal(result.durationMs, 0)
}

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

for (const { matcher, cases } of [
  {
    matcher: 'toBe',
    cases: [
      [1, 1, true],
      [1, 2, false],
      [NaN, NaN, true],
      [0, -0, false],
    ],
  },
  {
    matcher: 'toEqual',
    cases: [
      [{ value: 1 }, { value: 1 }, true],
      [{ value: 1 }, { value: 2 }, false],
    ],
  },
  {
    matcher: 'toMatchObject',
    cases: [
      [{ value: 1, extra: 2 }, { value: 1 }, true],
      [{ value: 1 }, { value: 2 }, false],
      [{ value: 1 }, { missing: undefined }, false],
      [{ value: undefined }, { value: undefined }, true],
    ],
  },
  {
    matcher: 'toSatisfy',
    cases: [
      [2, (value) => value === 2, true],
      [2, (value) => value === 3, false],
    ],
  },
]) {
  test(`result.${matcher} distinguishes matches from mismatches`, async () => {
    for (const [actual, expected, matches] of cases) {
      const suite = new Test()
        .target(() => actual)
        .it('matcher', (t) => t.args().expect((e) => [e.result[matcher](expected)]))
      const result = await run(suite)
      const attempt = result.tests[0].cases[0].attempts[0]
      assert.equal(result.status, matches ? 'passed' : 'failed')
      assert.equal(attempt.assertions[0].status, matches ? 'passed' : 'failed')
      if (!matches) assert.equal(attempt.failures[0].kind, 'assertion')
    }
  })
}

for (const { matcher, actual, matching, mismatching } of [
  { matcher: 'toBeInstanceOf', actual: new TypeError('boom'), matching: Error, mismatching: RangeError },
  { matcher: 'toThrow', actual: new Error('boom'), matching: 'oo', mismatching: 'different' },
  {
    matcher: 'toMatchObject',
    actual: { code: 'ENOENT', detail: 1 },
    matching: { code: 'ENOENT' },
    mismatching: { code: 'EIO' },
  },
  {
    matcher: 'toSatisfy',
    actual: undefined,
    matching: (value) => value === undefined,
    mismatching: (value) => value !== undefined,
  },
]) {
  test(`error.${matcher} distinguishes matches from mismatches`, async () => {
    for (const [expected, matches] of [
      [matching, true],
      [mismatching, false],
    ]) {
      const suite = new Test()
        .target(() => Promise.reject(actual))
        .it('matcher', (t) => t.args().expect((e) => [e.error[matcher](expected)]))
      const result = await run(suite)
      const attempt = result.tests[0].cases[0].attempts[0]
      assert.equal(result.status, matches ? 'passed' : 'failed')
      assert.equal(attempt.assertions[0].status, matches ? 'passed' : 'failed')
      if (!matches) assert.equal(attempt.failures[0].kind, 'assertion')
    }
  })
}

test('toThrow rejects non-Error values even when their messages match', async () => {
  for (const actual of ['boom', undefined, null, 42, { message: 'boom' }]) {
    const suite = new Test()
      .target(() => Promise.reject(actual))
      .it('non-Error', (t) => t.args().expect((e) => [e.error.toThrow('boom')]))
    const result = await run(suite)
    assert.equal(result.status, 'failed')
    assert.equal(result.tests[0].cases[0].attempts[0].failures[0].kind, 'assertion')
  }
})

test('toThrow ignores and preserves RegExp lastIndex for matching and nonmatching errors', async () => {
  for (const flags of ['g', 'y']) {
    const pattern = new RegExp('boom', flags)
    pattern.lastIndex = 2
    for (const [message, matches] of [
      ['boom', true],
      ['different', false],
      ['boom', true],
    ]) {
      const suite = new Test()
        .target(() => Promise.reject(new Error(message)))
        .it('RegExp', (t) => t.args().expect((e) => [e.error.toThrow(pattern)]))
      assert.equal((await run(suite)).status, matches ? 'passed' : 'failed')
      assert.equal(pattern.lastIndex, 2)
    }
  }
})

for (const { matcher, cases } of [
  {
    matcher: 'calledTimes',
    cases: [
      [[], [0], true],
      [[[1], [2]], [2], true],
      [[[1], [2]], [1], false],
    ],
  },
  {
    matcher: 'notCalled',
    cases: [
      [[], [], true],
      [[[1]], [], false],
    ],
  },
  {
    matcher: 'calledWith',
    cases: [
      [[[1], [2]], [2], true],
      [[[1], [2]], [3], false],
    ],
  },
  {
    matcher: 'calledOnceWith',
    cases: [
      [[[1]], [1], true],
      [[[1]], [2], false],
      [[[1], [1]], [1], false],
    ],
  },
  {
    matcher: 'calledNthWith',
    cases: [
      [[[1], [2]], [2, 2], true],
      [[[1], [2]], [1, 2], false],
      [[[1], [2]], [3, 2], false],
    ],
  },
]) {
  test(`${matcher} checks call counts and arguments`, async () => {
    for (const [calls, args, matches] of cases) {
      const service = {
        read(value) {
          return value
        },
      }
      const original = service.read
      const suite = new Test()
        .target(() => {
          for (const values of calls) service.read(...values)
        })
        .it('calls', (t) => t.args().expectCalls((call) => [call(service, 'read')[matcher](...args)]))
      const result = await run(suite)
      const attempt = result.tests[0].cases[0].attempts[0]
      assert.equal(result.status, matches ? 'passed' : 'failed')
      assert.equal(attempt.assertions[0].status, matches ? 'passed' : 'failed')
      if (!matches) assert.equal(attempt.failures[0].kind, 'assertion')
      assert.equal(service.read, original)
    }
  })
}

test('only, skip and todo leave no attempts', async () => {
  const calls = []
  let middlewareCalls = 0
  const suite = new Test()
    .use(
      middleware(async (_, next) => {
        middlewareCalls++
        return next()
      }),
    )
    .target((a, b) => {
      calls.push([a, b])
      return add(a, b)
    })
    .it('normal', (t) => t.args(1, 2).expect((e) => [e.result.toBe(3)]))
    .only('exclusive', (t) => t.args(2, 2).expect((e) => [e.result.toBe(4)]))
    .skip('disabled', (t) => t.args(1, 1).expect((e) => [e.result.toBe(2)]))
    .todo('later')
  const result = await run(suite)
  assert.deepEqual(
    result.tests[0].cases.map((x) => x.notRun),
    ['skipped', undefined, 'skipped', 'todo'],
  )
  const [normal, exclusive, skipped, todo] = result.tests[0].cases
  assertNotRun(normal, 'skipped')
  assertNotRun(skipped, 'skipped')
  assertNotRun(todo, 'todo')
  assert.equal(Object.hasOwn(exclusive, 'notRun'), false)
  assert.equal(exclusive.attempts.length, 1)
  assert.equal(exclusive.attempts[0].status, 'passed')
  assert.deepEqual(calls, [[2, 2]])
  assert.equal(middlewareCalls, 1)
  await assert.rejects(run(suite, { forbidOnly: true }), /only is forbidden/)
  assert.deepEqual(calls, [[2, 2]])
  assert.equal(middlewareCalls, 1)
})

test('skip and todo do not start targets or middleware without only', async () => {
  let targetCalls = 0,
    middlewareCalls = 0
  const suite = new Test()
    .use(
      middleware(async (_, next) => {
        middlewareCalls++
        return next()
      }),
    )
    .target(() => ++targetCalls)
    .skip('skipped', (t) => t.args().expect((e) => [e.result.toBe(1)]))
    .todo('todo')
  const result = await run(suite)
  assert.equal(result.status, 'passed')
  assertNotRun(result.tests[0].cases[0], 'skipped')
  assertNotRun(result.tests[0].cases[1], 'todo')
  assert.equal(targetCalls, 0)
  assert.equal(middlewareCalls, 0)
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

test('deep equality follows Vitest for cycles, undefined fields and array holes', async () => {
  const left = { value: 1 }
  left.self = left
  const right = { value: 1 }
  right.self = right
  const suite = new Test().target(() => left).it('cycle', (t) => t.args().expect((e) => [e.result.toEqual(right)]))
  assert.equal((await run(suite)).status, 'passed')
  const sparse = []
  sparse.length = 1
  const dense = [undefined]
  const holes = new Test().target(() => sparse).it('hole', (t) => t.args().expect((e) => [e.result.toEqual(dense)]))
  assert.equal((await run(holes)).status, 'passed')
  for (const [actual, expected] of [
    [{}, { missing: undefined }],
    [{ missing: undefined }, {}],
  ]) {
    const missing = new Test()
      .target(() => actual)
      .it('missing field', (t) => t.args().expect((e) => [e.result.toEqual(expected)]))
    assert.equal((await run(missing)).status, 'passed')
  }
})

test('value and call comparisons follow Vitest 5.0.2 equality criteria', async () => {
  const symbol = Symbol('id')
  class RecordValue {
    value = 1
  }
  const pairs = [
    ['same symbol', { [symbol]: 1 }, { [symbol]: 1 }, 'passed'],
    ['different symbols', { [Symbol('id')]: 1 }, { [Symbol('id')]: 1 }, 'failed'],
    ['symbol values', { [symbol]: 1 }, { [symbol]: 2 }, 'failed'],
    ['prototype', new RecordValue(), { value: 1 }, 'passed'],
    ['date', new Date(0), new Date(0), 'passed'],
    ['different date', new Date(0), new Date(1), 'failed'],
    ['regexp', /x/g, /x/g, 'passed'],
    ['different regexp', /x/g, /y/g, 'failed'],
    [
      'map order',
      new Map([
        [1, 2],
        [3, 4],
      ]),
      new Map([
        [3, 4],
        [1, 2],
      ]),
      'passed',
    ],
    ['set order', new Set([1, 2]), new Set([2, 1]), 'passed'],
    ['undefined field', { value: undefined }, {}, 'passed'],
  ]
  for (const [name, actual, expected, status] of pairs) {
    const service = { read: (value) => value }
    const suite = new Test()
      .target(() => service.read(actual))
      .it(name, (t) =>
        t
          .args()
          .expect((e) => [e.result.toEqual(expected)])
          .expectCalls((call) => [call(service, 'read').calledOnceWith(expected)]),
      )
    const result = await run(suite)
    assert.equal(result.status, status, name)
    assert.deepEqual(
      result.tests[0].cases[0].attempts[0].assertions.map((item) => item.status),
      [status, status],
      name,
    )
  }
})

test('partial comparisons follow Vitest 5.0.2 special-value criteria', async () => {
  const symbol = Symbol('id')
  const pairs = [
    ['same date', { at: new Date(0) }, { at: new Date(0) }, 'passed'],
    ['different date', { at: new Date(0) }, { at: new Date(1) }, 'failed'],
    ['date type', { at: new Date(0) }, { at: new Date(0).toISOString() }, 'failed'],
    ['map values', { m: new Map([[1, 2]]) }, { m: new Map([[1, 3]]) }, 'failed'],
    [
      'map size',
      {
        m: new Map([
          [1, 2],
          [3, 4],
        ]),
      },
      { m: new Map([[1, 2]]) },
      'failed',
    ],
    ['map subset', { m: new Map([[1, { a: 1, b: 2 }]]) }, { m: new Map([[1, { a: 1 }]]) }, 'passed'],
    ['set values', { s: new Set([1]) }, { s: new Set([2]) }, 'failed'],
    ['set size', { s: new Set([1, 2]) }, { s: new Set([1]) }, 'failed'],
    ['set subset', { s: new Set([{ a: 1, b: 2 }]) }, { s: new Set([{ a: 1 }]) }, 'passed'],
    ['array length', { a: [1, 2] }, { a: [1] }, 'failed'],
    ['missing undefined', {}, { missing: undefined }, 'failed'],
    ['regexp shape', { r: /x/g }, { r: /y/i }, 'passed'],
    ['weak map shape', { w: new WeakMap() }, { w: new WeakMap() }, 'passed'],
    ['promise shape', { p: Promise.resolve(1) }, { p: Promise.resolve(2) }, 'passed'],
    ['symbol-only shape', { [symbol]: 1 }, { [symbol]: 2 }, 'passed'],
  ]
  for (const [name, actual, expected, status] of pairs) {
    for (const subject of ['result', 'error']) {
      const suite = new Test()
        .target(() => {
          if (subject === 'error') throw actual
          return actual
        })
        .it(name, (t) => t.args().expect((e) => [e[subject].toMatchObject(expected)]))
      assert.equal((await run(suite)).status, status, `${subject}: ${name}`)
    }
  }
})

test('group cleanup deadlines apply after failed children and cancel later roots', async () => {
  for (const synchronous of [false, true]) {
    const child = new Test().target(() => 1).it('fails', (t) => t.args().expect((e) => [e.result.toBe(2)]))
    let cleaned = false
    const group = new Test().group(
      middleware(
        async (_, next) => {
          try {
            return await next()
          } finally {
            if (synchronous) {
              const deadline = performance.now() + 50
              while (performance.now() < deadline) {
                /* Block beyond the cleanup deadline. */
              }
            } else await new Promise((resolve) => setTimeout(resolve, 50))
            cleaned = true
          }
        },
        { timeout: 10 },
      ),
      [child],
    )
    const later = new Test()
      .target(() => assert.fail('later root ran'))
      .it('later', (t) => t.args().expect((e) => [e.result.toBe(1)]))
    const result = await run([group, later])
    assert.equal(result.reason, 'timeout')
    assert.equal(cleaned, true)
    assert.equal(result.tests[0].middleware.status, 'failed')
    assert.equal(result.tests[0].middleware.cleanup, 'complete')
    assert.equal(result.tests[0].middleware.failures[0].kind, 'timeout')
    assert.equal(result.tests[0].middleware.failures[0].phase, 'after')
    assert.equal(result.tests[0].children[0].result.cases[0].attempts[0].failures[0].kind, 'assertion')
    assertNotRun(result.tests[1].cases[0], 'cancelled')
  }
})

test('failed restoration of a nonconfigurable method aborts later cases without retry', async () => {
  const original = () => 1
  const service = Object.defineProperty({}, 'read', { value: original, writable: true, configurable: false })
  const suite = new Test()
    .retry(1)
    .target(() => {
      Object.defineProperty(service, 'read', { writable: false })
      return service.read()
    })
    .it('locks mock', (t) =>
      t
        .mock(service, 'read', (m) => m.returns(2))
        .args()
        .expect((e) => [e.result.toBe(2)]),
    )
    .it('later', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  const result = await run(suite)
  const first = result.tests[0].cases[0]
  assert.equal(result.status, 'failed')
  assert.equal(result.reason, 'cleanup-failed')
  assert.equal(first.attempts.length, 1)
  assert.equal(first.attempts[0].cleanup, 'incomplete')
  assert.equal(first.attempts[0].failures[0].phase, 'cleanup')
  assert.match(first.attempts[0].failures[0].message, /restoration failed/)
  assertNotRun(result.tests[0].cases[1], 'cancelled')
})

test('cleanup timeout preserves both child and cleanup failures', async () => {
  const child = new Test().target(() => 1).it('fails', (t) => t.args().expect((e) => [e.result.toBe(2)]))
  const close = async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    throw new Error('close failed')
  }
  const group = new Test().group(
    middleware(
      async (_, next) => {
        try {
          return await next()
        } finally {
          await close()
        }
      },
      { timeout: 10 },
    ),
    [child],
  )
  const result = await run(group)
  assert.equal(result.reason, 'timeout')
  const outer = result.tests[0]
  assert.equal(outer.middleware.cleanup, 'incomplete')
  assert.deepEqual(
    outer.middleware.failures.map((issue) => issue.kind),
    ['execution', 'timeout'],
  )
  assert.match(outer.middleware.failures[0].message, /close failed/)
  assert.equal(outer.children[0].result.cases[0].attempts[0].failures[0].kind, 'assertion')
})

test('attempt cleanup timeout preserves an args error without inventing a cleanup failure', async () => {
  const suite = new Test()
    .use(
      middleware(
        async (_, next) => {
          try {
            return await next()
          } finally {
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
        },
        { timeout: 10 },
      ),
    )
    .target(() => 1)
    .it('args error', (t) =>
      t
        .argsFrom(() => {
          throw new Error('args failed')
        })
        .expect((e) => [e.result.toBe(1)]),
    )
  const result = await run(suite)
  assert.equal(result.reason, 'timeout')
  const attempt = result.tests[0].cases[0].attempts[0]
  assert.equal(attempt.cleanup, 'complete')
  assert.deepEqual(
    attempt.failures.map((issue) => issue.kind),
    ['execution', 'timeout'],
  )
  assert.match(attempt.failures[0].message, /args failed/)
  assert.equal(attempt.failures[1].stage, 'after')
})

test('rejected mock installation fails before calling the target', async () => {
  const service = new Proxy(
    Object.defineProperty({}, 'read', {
      value: () => 1,
      writable: true,
      configurable: false,
    }),
    { set: () => false },
  )
  let called = false
  const suite = new Test()
    .mock(service, 'read', (m) => m.returns(2))
    .target(() => {
      called = true
      return service.read()
    })
    .it('cannot instrument', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  const result = await run(suite)
  assert.equal(result.status, 'failed')
  assert.equal(called, false)
  assert.equal(result.tests[0].cases[0].attempts[0].failures[0].phase, 'instrumentation')
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
  let targetCalls = 0,
    middlewareCalls = 0
  const suite = new Test()
    .use(
      middleware(async (_, next) => {
        middlewareCalls++
        return next()
      }),
    )
    .target(async () => {
      targetCalls++
      controller.abort()
      return 1
    })
    .it('active', (t) => t.args().expect((e) => [e.result.toBe(1)]))
    .it('pending', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  const result = await run(suite, { signal: controller.signal })
  assert.equal(result.status, 'cancelled')
  assert.equal(result.reason, 'interrupted')
  assert.equal(result.tests[0].cases[0].attempts[0].status, 'cancelled')
  assertNotRun(result.tests[0].cases[1], 'cancelled')
  assert.equal(Object.hasOwn(result.tests[0].cases[0], 'notRun'), false)
  assert.equal(targetCalls, 1)
  assert.equal(middlewareCalls, 1)
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
  const shared = { value: 1 }
  const fields = Object.assign(Object.create(null), { answer: 42, shared })
  const contexts = []
  const suite = new Test()
    .use(middleware(async (_, next) => next(fields)))
    .use(
      middleware(async (ctx, next) => {
        contexts.push(ctx)
        return next()
      }),
    )
    .target((value, reference) => {
      reference.value++
      return value
    })
    .it('answer', (t) =>
      t
        .argsFrom((ctx) => {
          contexts.push(ctx)
          assert.equal(ctx.shared, shared)
          return [ctx.answer, ctx.shared]
        })
        .expect((e) => {
          contexts.push(e.ctx)
          assert.equal(e.ctx.shared, shared)
          assert.equal(e.ctx.shared.value, 2)
          return [e.result.toBe(42)]
        }),
    )
  assert.equal((await run(suite)).status, 'passed')
  assert.equal(contexts.length, 3)
  assert.equal(contexts[1], contexts[2])
  assert.equal(shared.value, 2)
  for (const ctx of contexts) {
    for (const mutate of [
      () => Reflect.set(ctx, 'answer', 0),
      () => Reflect.deleteProperty(ctx, 'answer'),
      () => Reflect.defineProperty(ctx, 'answer', { value: 0 }),
    ]) {
      // A rejected write may return false or throw; both must preserve the field.
      await Promise.allSettled([Promise.resolve().then(mutate)])
      assert.equal(Object.hasOwn(ctx, 'answer'), true)
      assert.equal(ctx.answer, 42)
      assert.equal(ctx.shared, shared)
    }
  }
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
  const [date, regexp, map] = result.tests[0].cases[0].attempts[0].outcome.value.items
  assert.equal(date.value, '2020-01-01T00:00:00.000Z')
  assert.equal(regexp.source, 'a')
  assert.equal(regexp.flags, 'g')
  assert.deepEqual(map.entries, [
    [
      { kind: 'number', value: 1 },
      { kind: 'number', value: 2 },
    ],
  ])
})
test('run owns the active guard while collecting its blueprint', async () => {
  const suite = new Test().target(() => 1).it('one', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  const blueprint = suite.blueprint.bind(suite)
  let nested,
    reads = 0
  suite.blueprint = () => {
    reads++
    nested = assert.rejects(run(suite), /a run is already active/)
    return blueprint()
  }
  const result = await run(suite)
  await nested
  assert.equal(result.status, 'passed')
  assert.equal(reads, 1)
})
