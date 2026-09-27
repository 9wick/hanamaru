// installed packageでは構築しにくい環境固有シナリオ（node_modules構築、TDZ、worker内部の観測、定義変更の検出など）をworkspaceのdistで検証する。
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vite-plus/test'
import {
  asGroup,
  childGroup,
  childTest,
  fixture,
  groupNode,
  invoke,
  jsonResult,
  middlewareOf,
  testNode,
  workspace,
  workspaceRuntime,
} from './harness.ts'

test('CLI reads config file and lets arguments override reporter', () => {
  const data = fixture(
    `export const cases = new Test().target(() => 1).it('one', t => t.args().expect(e => [e.result.toBe(1)]))`,
  )
  const configFile = join(data.dir, 'hanamaru.config.mjs')
  writeFileSync(configFile, `export default { reporter: 'json', collectionTimeout: 1000 }`)
  expect(jsonResult(invoke(workspace, data.file, '--config', configFile), 0).status).toBe('passed')
  const overridden = invoke(workspace, data.file, '--config', configFile, '--reporter', 'pretty')
  expect(overridden.status, overridden.stderr).toBe(0)
  expect(overridden.stdout).toMatch(/✓ one/)
})

test('CLI partial result preserves completed cases before a forced stop', () => {
  const data = fixture(
    `export const cases = new Test().timeout(10).target(async n => n === 1 ? 1 : new Promise(() => {})).it('done', t => t.args(1).expect(e => [e.result.toBe(1)])).it('hang', t => t.args(2).expect(e => [e.result.toBe(2)]))`,
  )
  const items = testNode(
    jsonResult(invoke(workspace, data.file, '--shutdown-grace', '20', '--reporter', 'json'), 1),
  ).cases
  expect(items[0].attempts[0].status).toBe('passed')
  expect(items[1].attempts[0].status).toBe('failed')
  expect(items[1].attempts[0].cleanup).toBe('incomplete')
})

test('CLI parent stops a synchronously blocked group preprocessor', () => {
  const data = fixture(
    `const child = new Test().target(() => 1).it('never', t => t.args().expect(e => [e.result.toBe(1)]))\nexport const group = new Test().group(middleware(async () => { while (true) {} }, { timeout: 10 }), [child])`,
  )
  const output = jsonResult(invoke(workspace, data.file, '--shutdown-grace', '20', '--reporter', 'json'), 1)
  expect(output.reason).toBe('timeout')
  const group = groupNode(output)
  expect(middlewareOf(group).status).toBe('failed')
  expect(childTest(group).cases[0].notRun).toBe('cancelled')
})

test('CLI executes attempts in a separate worker and keeps group resources and async context local', () => {
  const data = fixture(`
import { workerData, threadId } from 'node:worker_threads'
import { AsyncLocalStorage } from 'node:async_hooks'
const storage = new AsyncLocalStorage()
let starts = 0, ends = 0, attempts = 0
const child = new Test().retry(1).target(async read => {
  await Promise.resolve()
  if (attempts++ === 0) throw new Error('retry me')
  return [read(), starts, ends, workerData.role]
}).it('retried', t => t.argsFrom(ctx => [ctx.read])
  .expect(e => [e.result.toEqual(['scope', 1, 0, 'execution'])]))
const nested = new Test().group(middleware(async (ctx, next) => {
  const read = () => ctx.resource.read()
  return await next({ read })
}), [child])
export const a = new Test().group(middleware(async (_, next) => {
  if (workerData.role !== 'execution') throw new Error('collection ran middleware')
  starts++
  return await storage.run('scope', async () => {
    const resource = { read: () => storage.getStore(), threadId }
    try { return await next({ resource }) } finally { ends++ }
  })
}), [nested])
export const b = new Test().target(() => [starts, ends, attempts, workerData.role])
  .it('closed', t => t.args().expect(e => [e.result.toEqual([1, 1, 2, 'execution'])]))
`)
  const output = jsonResult(invoke(workspace, data.file, '-r', 'json'), 0)
  const item = childTest(childGroup(groupNode(output))).cases[0]
  expect(item.attempts.map((attempt) => [attempt.attempt, attempt.status])).toStrictEqual([
    [1, 'failed'],
    [2, 'passed'],
  ])
  expect(testNode(output, 1).cases[0].attempts[0].status).toBe('passed')
})

test('CLI selects attempts by path when names and child definitions are reused', () => {
  const data = fixture(`
const child = new Test().target(value => value)
  .it('duplicate', t => t.argsFrom(ctx => [ctx.value]).expect(e => [e.result.toBe(e.ctx.value)]))
  .it('duplicate', t => t.argsFrom(ctx => [ctx.value + 1]).expect(e => [e.result.toBe(e.ctx.value + 1)]))
const scope = value => middleware(async (_, next) => await next({ value }))
export const root = new Test().group('same', scope(10), [child]).group('same', scope(20), [child])
`)
  const output = jsonResult(invoke(workspace, data.file, '-r', 'json', '-t', 'duplicate'), 0)
  const items = output.tests.flatMap((node) => childTest(asGroup(node)).cases)
  expect(items.map((item) => item.path)).toStrictEqual([
    [0, 0, 0],
    [0, 0, 1],
    [1, 0, 0],
    [1, 0, 1],
  ])
  expect(
    items.map((item) => {
      const { outcome } = item.attempts[0]
      expect.assert(outcome !== null && outcome.value.kind === 'number')
      return outcome.value.value
    }),
  ).toStrictEqual([10, 11, 20, 21])
})

test('CLI rejects a changed definition before running its target', () => {
  const data = fixture(`
import { workerData } from 'node:worker_threads'
export const root = new Test().target(() => { console.error('SHOULD_NOT_RUN'); return 1 })
  .it(workerData.role === 'execution' ? 'changed' : 'original', t => t.args().expect(e => [e.result.toBe(1)]))
`)
  const result = invoke(workspace, data.file)
  expect(result.status).toBe(2)
  expect(result.stderr).toMatch(/definitions changed between collection and execution/)
  expect(result.stderr).not.toMatch(/SHOULD_NOT_RUN/)
})

test('CLI preserves group before and after failures across execution messages', () => {
  for (const phase of ['before', 'after']) {
    const data = fixture(`
const child = new Test().target(() => 1).it('child', t => t.args().expect(e => [e.result.toBe(1)]))
export const a = new Test().group(middleware(async (_, next) => {
  ${phase === 'before' ? "throw new Error('before failed')" : "try { return await next() } finally { throw new Error('after failed') }"}
}), [child])
export const b = new Test().target(() => 2).it('later', t => t.args().expect(e => [e.result.toBe(2)]))
`)
    const output = jsonResult(invoke(workspace, data.file, '-r', 'json'), 1)
    expect(output.reason, phase).toBe(phase === 'before' ? 'completed' : 'cleanup-failed')
    const group = groupNode(output)
    expect(middlewareOf(group).status, phase).toBe('failed')
    expect(childTest(group).cases[0].attempts.length, phase).toBe(phase === 'before' ? 0 : 1)
    expect(testNode(output, 1).cases[0].attempts.length, phase).toBe(phase === 'before' ? 1 : 0)
  }
})

test('CLI prepares every registered module mock and spy before loading any execution test file', () => {
  const data = fixture(`
import * as source from './data.mjs'
import { getData } from './data.mjs'
import { calc, observe } from './targets.mjs'
const slot = source
export const a = new Test().target(calc)
  .it('real-first', t => t.args(3).expect(e => [e.result.toBe(8)]))
  .it('fake', t => t.mock(slot, 'getData', m => m.callsFake(n => n + 10)).args(3)
    .expect(e => [e.result.toBe(26)]).expectCalls(call => [call(slot, 'getData').calledOnceWith(3)]))
  .it('failure', t => t.mock(slot, 'getData', m => m.returns(4)).args(3).expect(e => [e.result.toBe(999)]))
  .it('restored', t => t.args(3).expect(e => [e.result.toBe(8)]))
export const b = new Test().group([new Test().target(observe)
  .it('spy-one', t => t.args(3).expect(e => [e.result.toBe(8)])
    .expectCalls(call => [call(slot, 'observed').calledOnceWith(3)]))
  .it('spy-two', t => t.args(3).expect(e => [e.result.toBe(8)])
    .expectCalls(call => [call(slot, 'observed').calledOnceWith(3)]))])
function inlineCalc(n) { return getData(n) * 2 }
export const c = new Test().target(inlineCalc)
  .it('in-source', t => t.mock(slot, 'getData', m => m.returns(9)).args(3)
    .expect(e => [e.result.toBe(18)]).expectCalls(call => [call(slot, 'getData').calledOnceWith(3)]))
`)
  writeFileSync(join(data.dir, 'data.mjs'), 'export const getData = n => n + 1\nexport const observed = n => n + 5\n')
  writeFileSync(join(data.dir, 'extra.mjs'), 'export const extra = n => n + 5\n')
  writeFileSync(
    join(data.dir, 'targets.mjs'),
    `
import { getData, observed } from './data.mjs'
import { extra } from './extra.mjs'
export const calc = n => getData(n) * 2
export const observe = n => observed(n)
export const later = n => extra(n)
`,
  )
  const later = join(data.dir, 'z-later.test.mjs')
  writeFileSync(
    later,
    `
import { Test } from ${JSON.stringify(workspaceRuntime)}
import * as source from './extra.mjs'
import { later } from './targets.mjs'
const slot = source
export const root = new Test().mock(slot, 'extra', m => m.returns(42))
  .group([new Test().target(later).it('late-mock', t => t.args(3).expect(e => [e.result.toBe(42)]))])
`,
  )
  const output = jsonResult(invoke(workspace, data.file, later, '-r', 'json'), 1)
  expect(output.reason).toBe('completed')
  expect(testNode(output).cases.map((item) => item.attempts[0].status)).toStrictEqual([
    'passed',
    'passed',
    'failed',
    'passed',
  ])
  expect(childTest(groupNode(output, 1)).cases.map((item) => item.attempts[0].status)).toStrictEqual([
    'passed',
    'passed',
  ])
  expect(testNode(output, 2).cases[0].attempts[0].status).toBe('passed')
  expect(childTest(groupNode(output, 3)).cases[0].attempts[0].status).toBe('passed')
})

test('CLI surfaces TDZ and missing export errors instead of returning undefined', () => {
  for (const scenario of ['tdz', 'missing']) {
    const data = fixture(`import './broken.mjs'
export const cases = new Test().target(() => 1).it('unreachable', t => t.args().expect(e => [e.result.toBe(1)]))`)
    writeFileSync(
      join(data.dir, 'broken.mjs'),
      scenario === 'tdz'
        ? "import { early } from './cycle.mjs'; export const value = 1; export const observed = early"
        : "import { missing } from './cycle.mjs'; export const observed = missing",
    )
    writeFileSync(
      join(data.dir, 'cycle.mjs'),
      scenario === 'tdz'
        ? "import { value } from './broken.mjs'; export const early = value"
        : 'export const present = 1',
    )
    const result = invoke(workspace, data.file, '-r', 'json')
    expect(result.status, result.stderr).toBe(2)
    expect(result.stderr).toMatch(scenario === 'tdz' ? /ReferenceError/ : /SyntaxError.*missing/)
    expect(result.stdout).toBe('')
  }
})

test('CLI preserves live exports, captured imports, dynamic imports and function metadata', () => {
  const data = fixture(`
import * as source from './data.mjs'
import { read, captured, late } from './targets.mjs'
export const cases = new Test().target(async () => [read(), captured(), await late(), source.value, source.get.name, source.get.length])
  .it('fake', t => t.mock(source, 'get', m => m.returns(10)).args()
    .expect(e => [e.result.toEqual([10, 10, 10, 1, 'get', 0])]))
  .it('restored', t => t.args().expect(e => [e.result.toEqual([1, 1, 1, 1, 'get', 0])]))
`)
  writeFileSync(
    join(data.dir, 'data.mjs'),
    'export let value = 0; export function get() { return value }; export function bump() { value++ }',
  )
  writeFileSync(
    join(data.dir, 'targets.mjs'),
    `
import { get, bump } from './data.mjs'
bump()
export const captured = get
export function read() { return get() }
export async function late() { const path = './data.mjs'; return (await import(path)).get() }
`,
  )
  const result = invoke(workspace, data.file, '-r', 'json')
  expect(result.status, result.stderr).toBe(0)
})

test('CLI rejects malformed Vite config and propagates plugin errors', () => {
  const data = fixture(
    "export const cases = new Test().target(() => 1).it('one', t => t.args().expect(e => [e.result.toBe(1)]))",
  )
  const config = join(data.dir, 'hanamaru.config.mjs')
  for (const [source, message] of [
    ['export default { vite: [] }', /vite must be a config object/],
    [
      "export default { vite: { plugins: [{ name: 'broken', transform() { throw new Error('plugin failed') } }] } }",
      /plugin failed/,
    ],
  ] as const) {
    writeFileSync(config, source)
    const result = invoke(workspace, data.file, '-c', config)
    expect(result.status, result.stderr).toBe(2)
    expect(result.stderr).toMatch(message)
  }
})

test('CLI imports CommonJS packages and mocks their exports while keeping ESM packages transformable', () => {
  const data = fixture(`
import * as source from 'cjs-data'
import { read } from 'esm-reader'
export const cases = new Test().target(read)
  .it('fake', t => t.mock(source, 'getData', m => m.returns(9)).args()
    .expect(e => [e.result.toBe(9)]).expectCalls(call => [call(source, 'getData').calledOnceWith()]))
  .it('restored', t => t.args().expect(e => [e.result.toBe(2)]))
`)
  for (const name of ['cjs-data', 'esm-reader']) mkdirSync(join(data.dir, 'node_modules', name), { recursive: true })
  writeFileSync(
    join(data.dir, 'node_modules/cjs-data/package.json'),
    JSON.stringify({ name: 'cjs-data', main: 'index.js' }),
  )
  writeFileSync(join(data.dir, 'node_modules/cjs-data/index.js'), 'exports.getData = () => 2')
  writeFileSync(
    join(data.dir, 'node_modules/esm-reader/package.json'),
    JSON.stringify({ name: 'esm-reader', type: 'module', exports: './index.js' }),
  )
  writeFileSync(
    join(data.dir, 'node_modules/esm-reader/index.js'),
    "import { getData } from 'cjs-data'; export function read() { return getData() }",
  )
  expect(jsonResult(invoke(workspace, data.file, '-r', 'json'), 0).status).toBe('passed')
})
