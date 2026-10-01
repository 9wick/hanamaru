import { fileURLToPath } from 'node:url'
import { expect, test } from 'vite-plus/test'
import { Test, run } from '../../index.js'

const selfFile = fileURLToPath(import.meta.url)

const double = (value: number): number => value * 2

// 宣言行はこのファイル内の行番号なので、下の .it() を動かしたらこの定数も合わせる。
const itLine = 12

const suite = new Test().target(double).it('double', (t) => t.args(2).expect((e) => [e.result.toBe(4)]))

test('case origin points at the declaring test file itself', () => {
  const blueprint = suite.blueprint()
  expect.assert(blueprint.kind === 'test')
  const origin = blueprint.cases[0]?.origin
  expect(origin?.file).toBe(selfFile)
  expect(origin?.line).toBe(itLine)
})

test('basic test and blueprint do not run target during definition', async () => {
  let calls = 0
  const subject = (value: number) => {
    calls++
    return value * 2
  }
  const doubling = new Test().target(subject).it('double', (t) => t.args(2).expect((e) => [e.result.toBe(4)]))
  const bp = doubling.blueprint()
  expect(calls).toBe(0)
  expect(bp.kind).toBe('test')
  expect(bp.cases[0].origin.line > 0).toBe(true)
  const result = await run(doubling)
  expect(result.status).toBe('passed')
  const node = result.tests[0]
  expect.assert(node.kind === 'test')
  expect(node.cases[0].attempts[0]?.status).toBe('passed')
  expect(calls).toBe(1)
})

test('builders keep their definition data out of the public surface', () => {
  const base = new Test()
  const suiteBuilder = new Test().target(double).it('double', (t) => t.args(2).expect((e) => [e.result.toBe(4)]))
  expect('data' in base).toBe(false)
  expect('data' in suiteBuilder).toBe(false)
  expect(Object.keys(base)).toEqual([])
  expect(Object.keys(suiteBuilder)).toEqual([])
})

test('deriving a builder leaves the source blueprint unchanged', () => {
  const first = new Test().target(double).it('one', (t) => t.args(1).expect((e) => [e.result.toBe(2)]))
  const second = first.it('two', (t) => t.args(2).expect((e) => [e.result.toBe(4)]))
  const firstBlueprint = first.blueprint()
  const secondBlueprint = second.blueprint()
  expect.assert(firstBlueprint.kind === 'test')
  expect.assert(secondBlueprint.kind === 'test')
  expect(firstBlueprint.cases.map((item) => item.name)).toEqual(['one'])
  expect(secondBlueprint.cases.map((item) => item.name)).toEqual(['one', 'two'])
})

// ---------------------------------------------------------------------------
// 特性テスト: DSLの現在の挙動（文言・公開面・instanceof・コールバック回数）を固定する。
// 位置と件数はe2eで見るため、ここでは値と回数だけを見る。
// importを末尾に置くのは、上のitLineが指す物理行を動かさないため。
// ---------------------------------------------------------------------------

import { collectWithin } from '../../application/collection/current-scope.js'
import { createCollectionScope, registrationsIn, unregisteredDefinitions } from '../../application/collection/scope.js'
import { middleware, registerTest } from '../../index.js'
import type { Assertions, CallsBuilder, Expect, ItBuilder, ItDone, Middleware, MockDef } from '../../index.js'
import { definitionTag, doneTag, middlewareTag } from '../../domain/definition/tags.js'
import type { Value } from '../../foundation/value.js'
import { invoke, objectValue, property } from '../../foundation/value.js'

/** 型が通らない呼び出しも実行時の経路として叩くための窓口。asも型述語も使わず、検証済みの値だけを渡す。 */
function callMethod(receiver: Value, key: PropertyKey, ...args: Value[]): Value {
  return invoke(objectValue(property(receiver, key)), receiver, args)
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'a non-Error value was thrown'
}

function thrown(act: () => unknown): string {
  try {
    act()
  } catch (error) {
    return describeError(error)
  }
  return 'nothing was thrown'
}

async function rejected(act: () => Value): Promise<string> {
  try {
    await Promise.resolve(act())
  } catch (error) {
    return describeError(error)
  }
  return 'nothing was thrown'
}

const host = {
  method(): number {
    return 1
  },
  notAFunction: 1,
}

const pass: Middleware<{}, {}> = middleware((_ctx, next) => next())
const returnsOne: MockDef<typeof host.method> = (m) => m.returns(1)
const noCalls: CallsBuilder<{}> = (call) => [call(host, 'method').notCalled()]
const fourAssertions = (e: Expect<typeof double, {}>): Assertions => [e.result.toBe(4)]
const okBody = (t: ItBuilder<typeof double, {}>): ItDone => t.args(2).expect(fourAssertions)
const targeted = () => new Test().target(double)
const suiteOf = () => targeted().it('ok', okBody)
const groupOf = () => new Test().group([suiteOf()])
const fixedSettings = 'common settings are fixed after the first group or case'
const incompleteCase = 'case must return args and an expectation'

const stageViolations: [string, () => unknown, string][] = [
  ['timeout after a case', () => callMethod(suiteOf(), 'timeout', 1), fixedSettings],
  ['retry after a case', () => callMethod(suiteOf(), 'retry', 1), fixedSettings],
  ['use after a case', () => callMethod(suiteOf(), 'use', pass), fixedSettings],
  ['mock after a case', () => callMethod(suiteOf(), 'mock', host, 'method', returnsOne), fixedSettings],
  ['timeout after a group', () => callMethod(groupOf(), 'timeout', 1), fixedSettings],
  ['use with a bare function', () => callMethod(new Test(), 'use', () => undefined), 'use requires middleware()'],
  ['use with a plain object', () => callMethod(new Test(), 'use', {}), 'use requires middleware()'],
  ['target twice', () => callMethod(targeted(), 'target', double), 'target already selected'],
  ['target without arguments', () => callMethod(new Test(), 'target'), 'target requires a function or object method'],
  ['target with a number', () => callMethod(new Test(), 'target', 1), 'target requires a function or object method'],
  [
    'target with only a name',
    () => callMethod(new Test(), 'target', 'n'),
    'target requires a function or object method',
  ],
  ['it before target', () => callMethod(new Test(), 'it', 'a', okBody), 'select target before cases'],
  ['only before target', () => callMethod(new Test(), 'only', 'a', okBody), 'select target before cases'],
  ['skip before target', () => callMethod(new Test(), 'skip', 'a', okBody), 'select target before cases'],
  ['todo before target', () => callMethod(new Test(), 'todo', 'a'), 'select target before cases'],
  ['each before target', () => callMethod(new Test(), 'each', 'a', [1], okBody), 'select target before cases'],
  ['it with a number name', () => callMethod(targeted(), 'it', 1, okBody), 'case name must be a string'],
  ['todo with a number name', () => callMethod(targeted(), 'todo', 1), 'case name must be a string'],
  ['it without a body', () => callMethod(targeted(), 'it', 'a'), 'case requires a body'],
  ['it with a null body', () => callMethod(targeted(), 'it', 'a', null), 'case requires a body'],
  ['group after target', () => callMethod(targeted(), 'group', [suiteOf()]), 'group requires a group builder'],
  ['group after a case', () => callMethod(suiteOf(), 'group', [suiteOf()]), 'group requires a group builder'],
  ['group without arguments', () => callMethod(new Test(), 'group'), 'group requires completed children'],
  ['group with only a name', () => callMethod(new Test(), 'group', 'name'), 'group requires completed children'],
  ['group with an empty list', () => callMethod(new Test(), 'group', []), 'group requires completed children'],
  [
    'group with an unfinished child',
    () => callMethod(new Test(), 'group', [new Test()]),
    'group requires completed children',
  ],
  [
    'group with two lists',
    () => callMethod(new Test(), 'group', [suiteOf()], [suiteOf()]),
    'group requires completed children',
  ],
  ['each with no rows', () => callMethod(targeted(), 'each', 'a', [], okBody), 'each requires nonempty rows'],
  [
    'each with rows that are not an array',
    () => callMethod(targeted(), 'each', 'a', 'rows', okBody),
    'value must be an array',
  ],
  ['blueprint before target', () => callMethod(new Test(), 'blueprint'), 'test definition is incomplete'],
  ['blueprint before any case', () => callMethod(targeted(), 'blueprint'), 'test definition is incomplete'],
  [
    'mock with a symbol key',
    () => callMethod(new Test(), 'mock', host, Symbol('key'), returnsOne),
    'mock target must be a method',
  ],
  [
    'mock with an unknown key',
    () => callMethod(new Test(), 'mock', host, 'missing', returnsOne),
    'method target does not exist',
  ],
  [
    'mock on a non-function property',
    () => callMethod(new Test(), 'mock', host, 'notAFunction', returnsOne),
    'method target must be a data property containing a function',
  ],
  ['mock on null', () => callMethod(new Test(), 'mock', null, 'method', returnsOne), 'method target must be an object'],
  [
    'mock with a definition that is not a function',
    () => callMethod(new Test(), 'mock', host, 'method', 1),
    'callback must be a function',
  ],
  [
    'mock with a definition returning a plain object',
    () => callMethod(new Test(), 'mock', host, 'method', () => ({})),
    'mock builder must return a completed behavior',
  ],
  [
    'mock with a definition returning a number',
    () => callMethod(new Test(), 'mock', host, 'method', () => 1),
    'value must be an object',
  ],
  ['timeout of zero', () => new Test().timeout(0), 'timeout must be a positive finite number'],
  ['timeout of NaN', () => new Test().timeout(Number.NaN), 'timeout must be a positive finite number'],
  ['retry below zero', () => new Test().retry(-1), 'retry must be a nonnegative safe integer'],
  ['retry that is not an integer', () => new Test().retry(1.5), 'retry must be a nonnegative safe integer'],
  ['middleware without a function', () => invoke(middleware, undefined, [1]), 'middleware requires a function'],
  [
    'middleware with a timeout of zero',
    () => middleware((_ctx, next) => next(), { timeout: 0 }),
    'middleware timeout must be a positive finite number',
  ],
  [
    'case timeout of zero',
    () => targeted().it('a', (t) => t.timeout(0).args(2).expect(fourAssertions)),
    'timeout must be a positive finite number',
  ],
  [
    'case retry below zero',
    () => targeted().it('a', (t) => t.retry(-1).args(2).expect(fourAssertions)),
    'retry must be a nonnegative safe integer',
  ],
  [
    'case mock with an unknown key',
    () => callMethod(targeted(), 'it', 'a', (t: Value) => callMethod(t, 'mock', host, 'missing', returnsOne)),
    'method target does not exist',
  ],
  [
    'expect twice',
    () =>
      callMethod(targeted(), 'it', 'a', (t: Value) =>
        callMethod(callMethod(callMethod(t, 'args', 2), 'expect', fourAssertions), 'expect', fourAssertions),
      ),
    'expect already set',
  ],
  [
    'expectCalls twice',
    () =>
      callMethod(targeted(), 'it', 'a', (t: Value) =>
        callMethod(callMethod(callMethod(t, 'args', 2), 'expectCalls', noCalls), 'expectCalls', noCalls),
      ),
    'expectCalls already set',
  ],
  ['a case body that returns the builder', () => callMethod(targeted(), 'it', 'a', (t: Value) => t), incompleteCase],
  [
    'a case body with args only',
    () => callMethod(targeted(), 'it', 'a', (t: Value) => callMethod(t, 'args', 2)),
    incompleteCase,
  ],
  [
    'a case body with an expectation but no args',
    () => callMethod(targeted(), 'it', 'a', (t: Value) => callMethod(t, 'expect', fourAssertions)),
    incompleteCase,
  ],
  [
    'reading the done tag on a fresh case builder',
    () => callMethod(targeted(), 'it', 'a', (t: Value) => property(t, doneTag)),
    incompleteCase,
  ],
  [
    'registerTest with an unfinished definition',
    () => invoke(registerTest, undefined, [new Test()]),
    'registerTest requires a completed test definition',
  ],
]

test.each(stageViolations)('%s is rejected with its own message', (_label, act, message) => {
  expect(thrown(act)).toBe(`TypeError: ${message}`)
})

const schemaViolations: [string, () => unknown, string][] = [
  [
    'group with a plain object child',
    () => callMethod(new Test(), 'group', [{}]),
    'Expected DefinitionBuilder but received Object',
  ],
  [
    'group with children that are not an array',
    () => callMethod(new Test(), 'group', 1),
    'Expected Array but received 1',
  ],
  [
    'a case body that returns nothing',
    () => callMethod(targeted(), 'it', 'a', () => undefined),
    'Expected CaseBuilder but received undefined',
  ],
  [
    'a case body that returns a number',
    () => callMethod(targeted(), 'it', 'a', () => 1),
    'Expected CaseBuilder but received 1',
  ],
  [
    'registerTest with a plain object',
    () => invoke(registerTest, undefined, [{}]),
    'Expected DefinitionBuilder but received Object',
  ],
]

test.each(schemaViolations)('%s is rejected by the schema', (_label, act, message) => {
  expect(thrown(act)).toBe(`ValiError: Invalid type: ${message}`)
})

const chainValues: [string, object, Value][] = [
  ['new Test()', new Test(), undefined],
  ['.timeout()', new Test().timeout(100), undefined],
  ['.use()', new Test().use(pass), undefined],
  ['.target()', targeted(), undefined],
  ['.it()', suiteOf(), true],
  ['.group()', groupOf(), true],
]

test.each(chainValues)('%s exposes no string key and exactly one own symbol', (_label, value, tag) => {
  expect(Object.keys(value)).toEqual([])
  expect(Reflect.ownKeys(value)).toEqual([definitionTag])
  expect(property(value, definitionTag)).toBe(tag)
})

const instanceValues: [string, object, boolean][] = [
  ['new Test()', new Test(), true],
  ['.timeout()', new Test().timeout(100), false],
  ['.use()', new Test().use(pass), false],
  ['.target()', targeted(), false],
  ['.it()', suiteOf(), false],
  ['.group()', groupOf(), false],
]

test.each(instanceValues)('%s is an instance of Test only before the first chained call', (_label, value, expected) => {
  expect(value instanceof Test).toBe(expected)
})

test('a case builder keeps every own key private', () => {
  let keys: PropertyKey[] = ['not collected']
  targeted().it('ok', (t) => {
    keys = Reflect.ownKeys(t)
    return okBody(t)
  })
  expect(keys).toEqual([])
})

test('run works without a collection scope', async () => {
  const single = targeted().it('single', okBody)
  const grouped = new Test().group([targeted().it('inside a group', okBody)])
  const result = await run([single, grouped])
  expect(result.status).toBe('passed')
  expect(result.tests.map((node) => node.kind)).toEqual(['test', 'group'])
})

test.each([
  ['an empty list', []],
  ['an unfinished definition', new Test()],
  ['a plain object', {}],
])('run rejects %s', async (_label, input) => {
  expect(await rejected(() => invoke(run, undefined, [input]))).toBe('TypeError: run requires completed definitions')
})

test('each rejects empty rows before calling the name or the body', () => {
  const counts = { names: 0, bodies: 0 }
  const name = (row: number) => {
    counts.names++
    return `row ${row}`
  }
  const body = (t: ItBuilder<typeof double, {}>) => {
    counts.bodies++
    return okBody(t)
  }
  expect(thrown(() => callMethod(targeted(), 'each', name, [], body))).toBe('TypeError: each requires nonempty rows')
  expect(counts).toEqual({ names: 0, bodies: 0 })
})

test('each names the first row before the stage check rejects it', () => {
  const counts = { names: 0, bodies: 0 }
  const name = (row: number) => {
    counts.names++
    return `row ${row}`
  }
  const body = (t: ItBuilder<typeof double, {}>) => {
    counts.bodies++
    return okBody(t)
  }
  expect(thrown(() => callMethod(new Test(), 'each', name, [1, 2, 3], body))).toBe(
    'TypeError: select target before cases',
  )
  expect(counts).toEqual({ names: 1, bodies: 0 })
})

test('each calls the name and the body once per row and shares one origin', () => {
  const counts = { names: 0, bodies: 0 }
  const suiteBuilder = targeted().each(
    (row: number) => {
      counts.names++
      return `row ${row}`
    },
    [1, 2, 3],
    (t) => {
      counts.bodies++
      return okBody(t)
    },
  )
  expect(counts).toEqual({ names: 3, bodies: 3 })
  const blueprint = suiteBuilder.blueprint()
  expect.assert(blueprint.kind === 'test')
  expect(blueprint.cases.map((item) => item.name)).toEqual(['row 1', 'row 2', 'row 3'])
  expect(new Set(blueprint.cases.map((item) => item.origin)).size).toBe(1)
})

test('each stops at the row whose name is not a string', () => {
  const counts = { names: 0, bodies: 0 }
  const name = (row: number) => {
    counts.names++
    return row === 2 ? 42 : `row ${row}`
  }
  const body = (t: ItBuilder<typeof double, {}>) => {
    counts.bodies++
    return okBody(t)
  }
  expect(thrown(() => callMethod(targeted(), 'each', name, [1, 2, 3], body))).toBe(
    'ValiError: Invalid type: Expected string but received 42',
  )
  expect(counts).toEqual({ names: 2, bodies: 1 })
})

test('each stops at the row whose body throws', () => {
  const counts = { bodies: 0 }
  expect(
    thrown(() =>
      targeted().each('row', [1, 2, 3], (t, row) => {
        counts.bodies++
        if (row === 2) throw new TypeError('row failed')
        return okBody(t)
      }),
    ),
  ).toBe('TypeError: row failed')
  expect(counts).toEqual({ bodies: 2 })
})

/** middlewareに見える値。runの読み取り回数でgroupの評価順を観測する。 */
function countingMiddleware(counter: { reads: number }) {
  return {
    [middlewareTag]: true,
    kind: 'middleware',
    get run() {
      counter.reads++
      return pass.run
    },
    timeout: undefined,
  }
}

test('group checks its stage before reading the middleware', () => {
  const counter = { reads: 0 }
  expect(thrown(() => callMethod(targeted(), 'group', countingMiddleware(counter), [suiteOf()]))).toBe(
    'TypeError: group requires a group builder',
  )
  expect(counter.reads).toBe(0)
})

test('group reads the middleware before it counts the children', () => {
  const counter = { reads: 0 }
  expect(thrown(() => callMethod(new Test(), 'group', countingMiddleware(counter), [suiteOf()], [suiteOf()]))).toBe(
    'TypeError: group requires completed children',
  )
  expect(counter.reads).toBe(1)
})

test('a case name that is not a string is rejected before the body runs', () => {
  const counts = { bodies: 0 }
  const body = (t: ItBuilder<typeof double, {}>) => {
    counts.bodies++
    return okBody(t)
  }
  expect(thrown(() => callMethod(targeted(), 'it', 1, body))).toBe('TypeError: case name must be a string')
  expect(counts).toEqual({ bodies: 0 })
})

test('a mock definition runs once and a failing one leaves the builder usable', () => {
  const counts = { definitions: 0 }
  const builder = targeted()
  const failing: MockDef<typeof host.method> = () => {
    counts.definitions++
    throw new TypeError('mock failed')
  }
  expect(thrown(() => callMethod(builder, 'mock', host, 'method', failing))).toBe('TypeError: mock failed')
  expect(counts).toEqual({ definitions: 1 })
  expect(builder.it('still usable', okBody).blueprint().kind).toBe('test')
})

test('a mock definition is not reached when the stage or the target is wrong', () => {
  const counts = { definitions: 0 }
  const counting: MockDef<typeof host.method> = (m) => {
    counts.definitions++
    return m.returns(1)
  }
  expect(thrown(() => callMethod(suiteOf(), 'mock', host, 'method', counting))).toBe(`TypeError: ${fixedSettings}`)
  expect(thrown(() => callMethod(new Test(), 'mock', host, 'notAFunction', counting))).toBe(
    'TypeError: method target must be a data property containing a function',
  )
  expect(counts).toEqual({ definitions: 0 })
})

// ---------------------------------------------------------------------------
// 収集スコープとDSLの結合: 親にも登録にも取られなかった定義だけが残ること。
// ---------------------------------------------------------------------------

test('a collection scope reports the orphan definition and keeps every registration of this file', async () => {
  const scope = createCollectionScope()
  const orphan = await collectWithin(scope, async () => {
    const child = targeted().it('child', okBody)
    registerTest(new Test().group([child]))
    registerTest(targeted().each('row', [1, 2], (t, row) => t.args(row).expect((e) => [e.result.toBe(row * 2)])))
    return targeted().it('orphan', okBody)
  })
  const blueprint = orphan.blueprint()
  expect.assert(blueprint.kind === 'test')
  // groupの子・チェーンの途中値・eachが行ごとに作る途中値は、親に取られているので警告しない。
  expect(unregisteredDefinitions(scope, new Set([selfFile]))).toEqual([blueprint.cases[0]?.origin])
  expect(registrationsIn(scope, selfFile).map((entry) => entry.origin.file)).toEqual([selfFile, selfFile])
  expect(unregisteredDefinitions(scope, new Set(['other.ts']))).toEqual([])
})
