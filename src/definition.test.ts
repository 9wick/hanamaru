import { expect, test } from 'vite-plus/test'
import { fileURLToPath } from 'node:url'
import { Test, run } from './index.js'

const selfFile = fileURLToPath(import.meta.url)
const double = (value: number): number => value * 2

// 宣言行はこのファイル内の行番号なので、下の .it() を動かしたらこの定数も合わせる。
const itLine = 11

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
