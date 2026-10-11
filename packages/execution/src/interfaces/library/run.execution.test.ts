import { createTestTarget } from '@zeltjs/testing/vitest'
import { LibraryRun } from './run.js'
import { ValueComparison } from '../../infrastructure/comparison.js'
import { LocalExecutor } from '../../infrastructure/execution/local.js'
import { expect, test } from 'vite-plus/test'
import type {
  AttemptResult,
  CaseResult,
  Failure,
  GroupResult,
  MiddlewareResult,
  RunOptions,
  RunResult,
  TestResult,
} from '../../../../../src/index.js'
import { Test, middleware } from '../../../../../src/index.js'
import type { RunInput } from './run.js'

import type { Value } from '../../domain/execution/javascript.js'

const add = (a: number, b: number): number => a + b

// filterとsignalは公開RunOptionsにない内部オプション。オブジェクトリテラルを直接渡さずに型を合わせる。
const internalOptions = (options: RunInput): RunOptions => options

function testNode(result: RunResult, index = 0): TestResult {
  const node = result.tests[index]
  expect.assert(node.kind === 'test')
  return node
}

function groupNode(result: RunResult, index = 0): GroupResult {
  const node = result.tests[index]
  expect.assert(node.kind === 'group')
  return node
}

function childTest(group: GroupResult, index = 0): TestResult {
  const node = group.children[index].result
  expect.assert(node.kind === 'test')
  return node
}

// attemptsとfailuresはタプルの合併なので、展開してから配列として扱う。
function attemptsOf(item: CaseResult): readonly AttemptResult[] {
  return [...item.attempts]
}

function failuresOf(attempt: AttemptResult): readonly Failure[] {
  return [...attempt.failures]
}

function attemptOf(item: CaseResult, index = 0): AttemptResult {
  const attempt = attemptsOf(item)[index]
  expect.assert(attempt !== undefined)
  return attempt
}

function expectNotRun(item: CaseResult, reason: 'skipped' | 'todo' | 'cancelled') {
  expect(item.notRun).toBe(reason)
  expect(item.attempts).toStrictEqual([])
  expect(item.durationMs).toBe(0)
}

test('same child reads values from attempt or group provider', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const log: string[] = []
  const child = new Test<{ seed: number }>()
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
  expect((await run(attemptParent)).status).toBe('passed')
  expect(log).toStrictEqual(['open', 'close'])
  log.length = 0
  expect((await run(groupParent)).status).toBe('passed')
  expect(log).toStrictEqual(['open', 'close'])
})

test('group provider runs once across children, attempt middleware runs each attempt', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const log: string[] = []
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
  const child = new Test<{ seed: number }>()
    .target(add)
    .it('a', (t) => t.argsFrom((ctx) => [ctx.seed, 1]).expect((e) => [e.result.toBe(3)]))
    .it('b', (t) => t.argsFrom((ctx) => [ctx.seed, 2]).expect((e) => [e.result.toBe(4)]))
  const result = await run(new Test().use(rootUse).group(group, [child]))
  expect(result.status).toBe('passed')
  expect(log).toStrictEqual(['group+', 'use+', 'use-', 'use+', 'use-', 'group-'])
})

test('group middleware prethrow fails run and cancels children', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const child = new Test().target(add).it('never', (t) => t.args(1, 2).expect((e) => [e.result.toBe(3)]))
  const broken = middleware(async () => {
    throw new Error('open failed')
  })
  const result = await run(new Test().group(broken, [child]))
  const group = groupNode(result)
  expect(result.status).toBe('failed')
  expect(result.reason).toBe('completed')
  expect(group.middleware?.status).toBe('failed')
  expect(childTest(group).cases[0].notRun).toBe('cancelled')
})

test('retry records failures before success', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  let calls = 0
  const suite = new Test()
    .retry(1)
    .target(() => ++calls)
    .it('retry', (t) => t.args().expect((e) => [e.result.toBe(2)]))
  const result = await run(suite)
  expect(result.status).toBe('passed')
  expect(attemptsOf(testNode(result).cases[0]).map((x) => x.status)).toStrictEqual(['failed', 'passed'])
  const ordinary = new Test().target(add).it('ordinary', (t) => t.args(1, 2).expect((e) => [e.result.toBe(3)]))
  expect((await run(ordinary)).status).toBe('passed')
})

test('expected thrown target error passes; unexpected error fails', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const suite = new Test()
    .target(() => {
      throw new Error('boom')
    })
    .it('expected', (t) => t.args().expect((e) => [e.error.toThrow('boom')]))
  expect((await run(suite)).status).toBe('passed')
  const unexpected = new Test()
    .target((): number => {
      throw new Error('boom')
    })
    .it('unexpected', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  const result = await run(unexpected)
  expect(result.status).toBe('failed')
  expect(attemptOf(testNode(result).cases[0]).failures[0]?.kind).toBe('outcome')
})

test('toThrow rejects non-Error values even when their messages match', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  for (const actual of ['boom', undefined, null, 42, { message: 'boom' }]) {
    const suite = new Test()
      .target(() => Promise.reject(actual))
      .it('non-Error', (t) => t.args().expect((e) => [e.error.toThrow('boom')]))
    const result = await run(suite)
    expect(result.status, String(actual)).toBe('failed')
    expect(attemptOf(testNode(result).cases[0]).failures[0]?.kind, String(actual)).toBe('assertion')
  }
})

test('toThrow ignores and preserves RegExp lastIndex for matching and nonmatching errors', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const messages: readonly (readonly [string, boolean])[] = [
    ['boom', true],
    ['different', false],
    ['boom', true],
  ]
  for (const flags of ['g', 'y']) {
    const pattern = new RegExp('boom', flags)
    pattern.lastIndex = 2
    for (const [message, matches] of messages) {
      const suite = new Test()
        .target(() => Promise.reject(new Error(message)))
        .it('RegExp', (t) => t.args().expect((e) => [e.error.toThrow(pattern)]))
      expect((await run(suite)).status, `${flags}: ${message}`).toBe(matches ? 'passed' : 'failed')
      expect(pattern.lastIndex).toBe(2)
    }
  }
})

test('only, skip and todo leave no attempts', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const calls: number[][] = []
  let middlewareCalls = 0
  const suite = new Test()
    .use(
      middleware(async (_, next) => {
        middlewareCalls++
        return next()
      }),
    )
    .target((a: number, b: number) => {
      calls.push([a, b])
      return add(a, b)
    })
    .it('normal', (t) => t.args(1, 2).expect((e) => [e.result.toBe(3)]))
    .only('exclusive', (t) => t.args(2, 2).expect((e) => [e.result.toBe(4)]))
    .skip('disabled', (t) => t.args(1, 1).expect((e) => [e.result.toBe(2)]))
    .todo('later')
  const result = await run(suite)
  const node = testNode(result)
  expect(node.cases.map((x) => x.notRun)).toStrictEqual(['skipped', undefined, 'skipped', 'todo'])
  const [normal, exclusive, skipped, todo] = node.cases
  expectNotRun(normal, 'skipped')
  expectNotRun(skipped, 'skipped')
  expectNotRun(todo, 'todo')
  expect(Object.hasOwn(exclusive, 'notRun')).toBe(false)
  expect(exclusive.attempts.length).toBe(1)
  expect(attemptOf(exclusive).status).toBe('passed')
  expect(calls).toStrictEqual([[2, 2]])
  expect(middlewareCalls).toBe(1)
  await expect(run(suite, { forbidOnly: true })).rejects.toThrow(/only is forbidden/)
  expect(calls).toStrictEqual([[2, 2]])
  expect(middlewareCalls).toBe(1)
})

test('skip and todo do not start targets or middleware without only', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

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
  const node = testNode(result)
  expect(result.status).toBe('passed')
  expectNotRun(node.cases[0], 'skipped')
  expectNotRun(node.cases[1], 'todo')
  expect(targetCalls).toBe(0)
  expect(middlewareCalls).toBe(0)
})

test('group failure after next interrupts later roots', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const child = new Test().target(add).it('first', (t) => t.args(1, 2).expect((e) => [e.result.toBe(3)]))
  const later = new Test().target(add).it('later', (t) => t.args(1, 2).expect((e) => [e.result.toBe(3)]))
  const broken = middleware(async (_, next) => {
    await next()
    throw new Error('close failed')
  })
  const result = await run([new Test().group(broken, [child]), later])
  expect(result.status).toBe('failed')
  expect(result.reason).toBe('cleanup-failed')
  expect(testNode(result, 1).cases[0].notRun).toBe('cancelled')
})

test('filter preserves original paths and rejects empty selection', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const suite = new Test()
    .target(add)
    .it('first', (t) => t.args(1, 1).expect((e) => [e.result.toBe(2)]))
    .it('second', (t) => t.args(2, 2).expect((e) => [e.result.toBe(4)]))
  const result = await run(suite, internalOptions({ filter: 'second' }))
  expect(testNode(result).cases.map((x) => x.path)).toStrictEqual([[0, 1]])
  await expect(run(suite, internalOptions({ filter: 'missing' }))).rejects.toThrow(/filter matched no cases/)
})

test('same group definition can be reused with independent paths', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const child = new Test().target(add).it('one', (t) => t.args(1, 2).expect((e) => [e.result.toBe(3)]))
  const group = new Test().group([child])
  const result = await run(new Test().group([group, group]))
  expect(groupNode(result).children.map((x) => x.result.path)).toStrictEqual([
    [0, 0],
    [0, 1],
  ])
  expect(result.status).toBe('passed')
})

test('middleware contract errors do not retry', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  // 型上は正しい結果を返しつつnextを呼ばない違反を作るため、別の実行で得た結果を流用する。
  let captured: MiddlewareResult<{}> | undefined
  const capture = middleware(async (_, next) => {
    captured = await next()
    return captured
  })
  await run(
    new Test()
      .use(capture)
      .target(add)
      .it('capture', (t) => t.args(1, 2).expect((e) => [e.result.toBe(3)])),
  )
  expect.assert(captured !== undefined)
  const foreign = captured
  let entries = 0
  const broken = middleware(async () => {
    entries++
    return foreign
  })
  const suite = new Test()
    .retry(2)
    .use(broken)
    .target(add)
    .it('unreached', (t) => t.args(1, 2).expect((e) => [e.result.toBe(3)]))
  const result = await run(suite)
  expect(result.status).toBe('failed')
  expect(entries).toBe(1)
  expect(testNode(result).cases[0].attempts.length).toBe(1)
})

test('middleware timeout stops following cases', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const slow = middleware(
    async (_, next) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 12))
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
  const node = testNode(result)
  expect(result.status).toBe('failed')
  expect(result.reason).toBe('timeout')
  expect(failuresOf(attemptOf(node.cases[0])).some((x) => x.kind === 'timeout')).toBe(true)
  expect(node.cases[1].notRun).toBe('cancelled')
})

test('deep equality follows Vitest for cycles, undefined fields and array holes', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const left: { value: number; self?: object } = { value: 1 }
  left.self = left
  const right: { value: number; self?: object } = { value: 1 }
  right.self = right
  const suite = new Test().target(() => left).it('cycle', (t) => t.args().expect((e) => [e.result.toEqual(right)]))
  expect((await run(suite)).status).toBe('passed')
  const sparse: undefined[] = []
  sparse.length = 1
  const dense = [undefined]
  const holes = new Test().target(() => sparse).it('hole', (t) => t.args().expect((e) => [e.result.toEqual(dense)]))
  expect((await run(holes)).status).toBe('passed')
  const fields: readonly (readonly [Record<string, Value>, Record<string, Value>])[] = [
    [{}, { missing: undefined }],
    [{ missing: undefined }, {}],
  ]
  for (const [actual, expected] of fields) {
    const missing = new Test()
      .target(() => actual)
      .it('missing field', (t) => t.args().expect((e) => [e.result.toEqual(expected)]))
    expect((await run(missing)).status).toBe('passed')
  }
})

test('value and call comparisons follow Vitest 5.0.2 equality criteria', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const symbol = Symbol('id')
  class RecordValue {
    value = 1
  }
  const pairs: readonly (readonly [string, Value, Value, 'passed' | 'failed'])[] = [
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
    const service: { read: (value: Value) => Value } = { read: (value) => value }
    const suite = new Test()
      .target(() => service.read(actual))
      .it(name, (t) =>
        t
          .args()
          .expect((e) => [e.result.toEqual(expected)])
          .expectCalls((call) => [call(service, 'read').calledOnceWith(expected)]),
      )
    const result = await run(suite)
    expect(result.status, name).toBe(status)
    expect(
      attemptOf(testNode(result).cases[0]).assertions.map((item) => item.status),
      name,
    ).toStrictEqual([status, status])
  }
})

test('partial comparisons follow Vitest 5.0.2 special-value criteria', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const symbol = Symbol('id')
  type Fields = Record<PropertyKey, Value>
  const pairs: readonly (readonly [string, Fields, Fields, 'passed' | 'failed'])[] = [
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
    const returned = new Test()
      .target(() => actual)
      .it(name, (t) => t.args().expect((e) => [e.result.toMatchObject(expected)]))
    expect((await run(returned)).status, `result: ${name}`).toBe(status)
    const thrown = new Test()
      .target((): Fields => {
        throw actual
      })
      .it(name, (t) => t.args().expect((e) => [e.error.toMatchObject(expected)]))
    expect((await run(thrown)).status, `error: ${name}`).toBe(status)
  }
})

test('group cleanup deadlines apply after failed children and cancel later roots', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

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
                // 後処理の期限を超えるまで同期的にブロックする。
              }
            } else await new Promise<void>((resolve) => setTimeout(resolve, 50))
            cleaned = true
          }
        },
        { timeout: 10 },
      ),
      [child],
    )
    const later = new Test()
      .target((): number => {
        throw new Error('later root ran')
      })
      .it('later', (t) => t.args().expect((e) => [e.result.toBe(1)]))
    const result = await run([group, later])
    const node = groupNode(result)
    expect(result.reason, String(synchronous)).toBe('timeout')
    expect(cleaned).toBe(true)
    expect(node.middleware?.status).toBe('failed')
    expect(node.middleware?.cleanup).toBe('complete')
    expect(node.middleware?.failures[0]?.kind).toBe('timeout')
    expect(node.middleware?.failures[0]?.phase).toBe('after')
    expect(attemptOf(childTest(node).cases[0]).failures[0]?.kind).toBe('assertion')
    expectNotRun(testNode(result, 1).cases[0], 'cancelled')
  }
})

test('cleanup timeout preserves both child and cleanup failures', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const child = new Test().target(() => 1).it('fails', (t) => t.args().expect((e) => [e.result.toBe(2)]))
  const close = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
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
  expect(result.reason).toBe('timeout')
  const outer = groupNode(result)
  const outerMiddleware = outer.middleware
  expect.assert(outerMiddleware !== null)
  expect(outerMiddleware.cleanup).toBe('incomplete')
  expect([...outerMiddleware.failures].map((issue) => issue.kind)).toStrictEqual(['execution', 'timeout'])
  expect(outerMiddleware.failures[0]?.message).toMatch(/close failed/)
  expect(attemptOf(childTest(outer).cases[0]).failures[0]?.kind).toBe('assertion')
})

test('attempt cleanup timeout preserves an args error without inventing a cleanup failure', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const suite = new Test()
    .use(
      middleware(
        async (_, next) => {
          try {
            return await next()
          } finally {
            await new Promise<void>((resolve) => setTimeout(resolve, 50))
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
  expect(result.reason).toBe('timeout')
  const attempt = attemptOf(testNode(result).cases[0])
  expect(attempt.cleanup).toBe('complete')
  expect(failuresOf(attempt).map((issue) => issue.kind)).toStrictEqual(['execution', 'timeout'])
  expect(attempt.failures[0]?.message).toMatch(/args failed/)
  const second = attempt.failures[1]
  expect.assert(second?.kind === 'timeout')
  expect(second.stage).toBe('after')
})

test('diagnostics never invoke getters', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

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
  expect(result.status).toBe('failed')
  expect(invoked).toBe(0)
})

test('abort marks active and pending cases cancelled', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

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
  const result = await run(suite, internalOptions({ signal: controller.signal }))
  const node = testNode(result)
  expect(result.status).toBe('cancelled')
  expect(result.reason).toBe('interrupted')
  expect(attemptOf(node.cases[0]).status).toBe('cancelled')
  expectNotRun(node.cases[1], 'cancelled')
  expect(Object.hasOwn(node.cases[0], 'notRun')).toBe(false)
  expect(targetCalls).toBe(1)
  expect(middlewareCalls).toBe(1)
})

test('a failed child inside an ordinary group returns a failed result', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const child = new Test().target(add).it('wrong sum', (t) => t.args(1, 2).expect((e) => [e.result.toBe(4)]))
  const result = await run(new Test().group([child]))
  expect(result.status).toBe('failed')
  expect(attemptOf(childTest(groupNode(result)).cases[0]).status).toBe('failed')
})

test('a failed child does not become a group middleware failure', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const child = new Test().target(add).it('wrong sum', (t) => t.args(1, 2).expect((e) => [e.result.toBe(4)]))
  const wrapper = middleware(async (_, next) => {
    try {
      return await next()
    } finally {
      // 後処理では何もしないが、finallyがある形を保つ。
    }
  })
  const result = await run(new Test().group(wrapper, [child]))
  expect(result.status).toBe('failed')
  expect(groupNode(result).middleware?.status).toBe('passed')
})

test('group middleware reads stable group context before attempt values', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const rootAttempt = middleware(async (_, next) => next({ seed: 100 }))
  const outerGroup = middleware(async (_, next) => next({ seed: 2 }))
  const innerGroup = middleware(async (ctx: { seed: number }, next) => next({ expected: ctx.seed }))
  const child = new Test<{ seed: number; expected: number }>()
    .target((value: number) => value)
    .it('sees stable value', (t) => t.argsFrom((ctx) => [ctx.seed]).expect((e) => [e.result.toBe(e.ctx.expected)]))
  const inner = new Test<{ seed: number }>().group(innerGroup, [child])
  const result = await run(new Test().use(rootAttempt).group(outerGroup, [inner]))
  expect(result.status).toBe('passed')
})

test('contexts are readonly containers and null-prototype fields are accepted', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const shared = { value: 1 }
  const fields: { answer: number; shared: { value: number } } = { answer: 42, shared }
  // null prototypeのフィールドも受け付けることを確かめるため、実際にprototypeを外す。
  expect(Reflect.setPrototypeOf(fields, null)).toBe(true)
  const contexts: Readonly<typeof fields>[] = []
  const suite = new Test()
    .use(middleware(async (_, next) => next(fields)))
    .use(
      middleware(async (ctx: Readonly<typeof fields>, next) => {
        contexts.push(ctx)
        return next()
      }),
    )
    .target((value: number, reference: { value: number }) => {
      reference.value++
      return value
    })
    .it('answer', (t) =>
      t
        .argsFrom((ctx) => {
          contexts.push(ctx)
          expect(ctx.shared).toBe(shared)
          return [ctx.answer, ctx.shared]
        })
        .expect((e) => {
          contexts.push(e.ctx)
          expect(e.ctx.shared).toBe(shared)
          expect(e.ctx.shared.value).toBe(2)
          return [e.result.toBe(42)]
        }),
    )
  expect((await run(suite)).status).toBe('passed')
  expect(contexts.length).toBe(3)
  expect(contexts[1]).toBe(contexts[2])
  expect(shared.value).toBe(2)
  for (const ctx of contexts) {
    for (const mutate of [
      () => Reflect.set(ctx, 'answer', 0),
      () => Reflect.deleteProperty(ctx, 'answer'),
      () => Reflect.defineProperty(ctx, 'answer', { value: 0 }),
    ]) {
      // 書き込みの拒否はfalseでも例外でも起こりうる。どちらでもフィールドは保たれる。
      await Promise.allSettled([Promise.resolve().then(mutate)])
      expect(Object.hasOwn(ctx, 'answer')).toBe(true)
      expect(ctx.answer).toBe(42)
      expect(ctx.shared).toBe(shared)
    }
  }
})

test('predicate exceptions are failed assertions with execution causes', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

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
  const attempt = attemptOf(testNode(result).cases[0])
  expect(attempt.assertions[0]?.status).toBe('failed')
  expect(attempt.failures[0]?.kind).toBe('execution')
})

test('Error diagnostics include message and never call accessors', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

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
  const outcome = attemptOf(testNode(result).cases[0]).outcome
  expect.assert(outcome !== null && outcome.value.kind === 'object')
  const properties = outcome.value.properties
  expect(
    properties.some(
      (p) =>
        p.key.kind === 'string' &&
        p.key.value === 'message' &&
        p.value.kind === 'string' &&
        p.value.value === 'details',
    ),
  ).toBe(true)
  expect(
    properties.some((p) => p.key.kind === 'string' && p.key.value === 'other' && p.value.kind === 'accessor'),
  ).toBe(true)
  expect(reads).toBe(0)
})

test('attempt middleware postprocessing failure aborts later cases', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

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
  const node = testNode(result)
  expect(result.status).toBe('failed')
  expect(result.reason).toBe('cleanup-failed')
  expect(attemptOf(node.cases[0]).cleanup).toBe('incomplete')
  expect(node.cases[1].notRun).toBe('cancelled')
})

test('group middleware postprocessing failure reports incomplete cleanup', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  const broken = middleware(async (_, next) => {
    await next()
    throw new Error('after failed')
  })
  const child = new Test().target(() => 1).it('first', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  const result = await run(new Test().group(broken, [child]))
  expect(result.reason).toBe('cleanup-failed')
  expect(groupNode(result).middleware?.cleanup).toBe('incomplete')
})

test('diagnostics use built-in accessors for special objects', async () => {
  const { target: library } = await createTestTarget(LibraryRun, { configs: [ValueComparison, LocalExecutor] })
  const run = library.run.bind(library)

  let reads = 0
  class StrangeDate extends Date {
    getTime(): never {
      reads++
      throw new Error('override')
    }
  }
  class StrangeRegExp extends RegExp {}
  // globalはRegExpのプロパティなので、クラス内のアクセサ宣言では上書きできない。
  Object.defineProperty(StrangeRegExp.prototype, 'global', {
    get: (): never => {
      reads++
      throw new Error('override')
    },
  })
  class StrangeMap extends Map<number, number> {
    [Symbol.iterator](): never {
      reads++
      throw new Error('override')
    }
  }
  const suite = new Test()
    .target(() => [new StrangeDate('2020-01-01'), new StrangeRegExp('a', 'g'), new StrangeMap([[1, 2]])])
    .it('special', (t) => t.args().expect((e) => [e.result.toBe([])]))
  const result = await run(suite)
  expect(result.status).toBe('failed')
  expect(reads).toBe(0)
  const outcome = attemptOf(testNode(result).cases[0]).outcome
  expect.assert(outcome !== null && outcome.value.kind === 'array')
  const items = outcome.value.items
  expect(items.map((x) => x.kind)).toStrictEqual(['date', 'regexp', 'map'])
  const [date, regexp, map] = items
  expect.assert(date.kind === 'date' && regexp.kind === 'regexp' && map.kind === 'map')
  expect(date.value).toBe('2020-01-01T00:00:00.000Z')
  expect(regexp.source).toBe('a')
  expect(regexp.flags).toBe('g')
  expect(map.entries).toStrictEqual([
    [
      { kind: 'number', value: 1 },
      { kind: 'number', value: 2 },
    ],
  ])
})
