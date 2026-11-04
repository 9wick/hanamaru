// installed packageでは構築しにくい環境固有シナリオ（node_modules構築、TDZ、worker内部の観測、定義変更の検出など）をworkspaceのdistで検証する。
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vite-plus/test'
import * as v from 'valibot'
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

test('CLI reports target and cause stack frames in pretty and JSON failures', () => {
  const data = fixture(`
function inner() { throw new TypeError('inner failure') }
function outer() { try { inner() } catch (cause) { throw new Error('outer failure', { cause }) } }
export const root = new Test().target(outer).it('unexpected error', t => t.args().expect(e => [e.result.toBe(undefined)]))
`)
  const pretty = invoke(workspace, data.file)
  expect(pretty.status, pretty.stderr).toBe(1)
  expect(pretty.stdout).toContain('Error: outer failure')
  expect(pretty.stdout).toContain('TypeError: inner failure')
  expect(pretty.stdout).toMatch(/at outer .*sample\.test\.mjs:/)
  expect(pretty.stdout).toMatch(/at inner .*sample\.test\.mjs:/)
  const json = invoke(workspace, data.file, '--reporter', 'json')
  expect(json.status, json.stderr).toBe(1)
  expect(json.stdout).toContain('at inner')
  expect(json.stdout).toContain('at outer')
})

test('CLI reports comparison paths and changed values without dumping unrelated properties', () => {
  const data = fixture(`
export const root = new Test().target(() => ({ unrelated: 'DO_NOT_DUMP', evidence: [{ targets: ['user', 'repo'] }] }))
  .it('different order', t => t.args().expect(e => [e.result.part('evidence').part(0).part('targets').toEqual(['repo', 'user'])]))
`)
  const output = invoke(workspace, data.file)
  expect(output.status, output.stderr).toBe(1)
  expect(output.stdout).toContain('evidence[0].targets[0]')
  expect(output.stdout).toContain('- expected: "repo"')
  expect(output.stdout).toContain('+ actual:   "user"')
  expect(output.stdout).not.toContain('DO_NOT_DUMP')
})

test('in-source declarations expose private targets, list without execution and select one case with shared resources', () => {
  const data = fixture('')
  const dependency = join(data.dir, 'dependency.mjs')
  writeFileSync(dependency, 'export function read() { return 2 }')
  const file = join(data.dir, 'private.mjs')
  const source = `import * as dependency from './dependency.mjs'
const double = value => dependency.read() * value
if (import.meta.hanamaru) {
  const { Test, registerTest, middleware, resource } = import.meta.hanamaru
  const fixture = resource({ name: 'fixture', scope: 'perRun', async setup(_, next) {
    console.error('fixture opened')
    try { return await next({ left: 2, right: 3 }) } finally { console.error('fixture closed') }
  } })
  const child = new Test().require(fixture).target(double)
    .it('same', t => t.argsFrom(ctx => [ctx.left]).expect(e => [e.result.toBe(4)]))
    .it('same', t => t.argsFrom(ctx => [ctx.right]).expect(e => [e.result.toBe(6)]))
  registerTest(new Test().group('parent', middleware(async (_, next) => {
    try { return await next({}) } finally { console.error('parent closed') }
  }), [child]))
}
`
  writeFileSync(file, source)
  const normal = invoke({ ...workspace, args: [] }, file)
  expect(normal.status, normal.stderr).toBe(0)
  expect(normal.stdout).toBe('')
  const listed = invoke(workspace, file, '--list', '--reporter', 'json')
  expect(listed.status, listed.stderr).toBe(0)
  expect(listed.stderr).not.toContain('parent closed')
  expect(listed.stderr).not.toContain('fixture opened')
  const catalogue = v.parse(
    v.object({
      version: v.literal(1),
      definitions: v.array(v.object({ id: v.string() })),
      cases: v.array(v.object({ id: v.string(), name: v.string(), origin: v.object({ line: v.number() }) })),
    }),
    JSON.parse(listed.stdout),
  )
  expect(catalogue.cases.map((target) => target.name)).toEqual(['same', 'same'])
  expect(new Set(catalogue.cases.map((target) => target.id)).size).toBe(2)
  const selected = invoke(workspace, file, '--id', catalogue.cases[1].id, '--reporter', 'json')
  const output = jsonResult(selected, 0)
  expect(childTest(groupNode(output)).cases).toHaveLength(1)
  expect(childTest(groupNode(output)).cases[0].path).toEqual([0, 0, 1])
  expect(selected.stderr).toContain('parent closed')
  expect(selected.stderr).toContain('fixture opened')
  expect(selected.stderr).toContain('fixture closed')
  const located = jsonResult(invoke(workspace, `${file}:${catalogue.cases[0].origin.line}`, '--reporter', 'json'), 0)
  expect(childTest(groupNode(located)).cases[0].path).toEqual([0, 0, 0])
  expect(invoke(workspace, file, '--id', 'missing').status).toBe(2)
})

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
    `export const cases = new Test().target(async n => n === 1 ? 1 : new Promise(() => {})).it('done', t => t.args(1).expect(e => [e.result.toBe(1)])).it('hang', t => t.timeout(10).args(2).expect(e => [e.result.toBe(2)]))`,
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

test('CLI keeps imported dependencies real and supplies alternate dependencies through environments', () => {
  const data = fixture(`
import { environment } from ${JSON.stringify(workspaceRuntime)}
import { getData } from './data.mjs'
import { calc, Calculator } from './targets.mjs'
export const a = new Test().target(calc)
  .it('real-first', t => t.args(3).expect(e => [e.result.toEqual(8)]))
  .it('failure', t => t.args(3).expect(e => [e.result.toEqual(999)]))
  .it('real-again', t => t.args(3).expect(e => [e.result.toEqual(8)]))
const local = environment(async (_, scope, next) => next({ calculator: new Calculator(n => n + 10) }))
export const b = new Test().target(Calculator, 'calc').effectful().use(local).from(ctx => ctx.calculator)
  .it('explicit fake', t => t.args(3).expect(e => [e.result.toEqual(26)]))
function inlineCalc(n) { return getData(n) * 2 }
export const c = new Test().target(inlineCalc)
  .it('in-source', t => t.args(3).expect(e => [e.result.toEqual(8)]))
`)
  writeFileSync(join(data.dir, 'data.mjs'), 'export const getData = n => n + 1\n')
  writeFileSync(join(data.dir, 'extra.mjs'), 'export const extra = n => n + 5\n')
  writeFileSync(
    join(data.dir, 'targets.mjs'),
    `
import { getData } from './data.mjs'
import { extra } from './extra.mjs'
export const calc = n => getData(n) * 2
export const later = n => extra(n)
export class Calculator { constructor(read) { this.read = read } calc(n) { return this.read(n) * 2 } }
`,
  )
  const later = join(data.dir, 'z-later.test.mjs')
  writeFileSync(
    later,
    `
import { Test, registerTest } from ${JSON.stringify(workspaceRuntime)}
import { later } from './targets.mjs'
registerTest(new Test().group([new Test().target(later).it('later', t => t.args(3).expect(e => [e.result.toEqual(8)]))]))
`,
  )
  const output = jsonResult(invoke(workspace, data.file, later, '-r', 'json'), 1)
  expect(output.reason).toBe('completed')
  expect(testNode(output).cases.map((item) => item.attempts[0].status)).toEqual(['passed', 'failed', 'passed'])
  expect(testNode(output, 1).cases[0].attempts[0].status).toBe('passed')
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
export const cases = new Test().target(async advance => {
  if (advance) source.bump()
  return [read(), captured(), await late(), source.value, source.get.name, source.get.length]
}).effectful()
  .it('initial', t => t.args(false).expect(e => [e.result.toEqual([1, 1, 1, 1, 'get', 0])]))
  .it('live updates', t => t.args(true).expect(e => [e.result.toEqual([2, 2, 2, 2, 'get', 0])]))
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

test('CLI imports CommonJS dependencies while keeping ESM packages transformable', () => {
  const data = fixture(`
import * as source from 'cjs-data'
import { read } from 'esm-reader'
export const cases = new Test().target(read)
  .it('real dependency', t => t.args().expect(e => [e.result.toEqual(2)]))
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

test('worker progress does not commit a counterexample before cleanup succeeds', () => {
  const data = fixture(`
import { environment, tuples, constant } from ${JSON.stringify(workspaceRuntime)}
const local = environment(async (_, scope, next) => next({
  events: scope.action({ evidence: 'real-effect', open: () => ({ finish: () => [], dispose: () => { throw new Error('dispose failed') } }) })
}))
export const root = new Test().target(x => x).effectful().use(local)
  .property('cleanup failure', p => p.forAll(tuples(constant(1))).expect(e => [e.result.toEqual(2), e.action(e.ctx.events).untilTargetSettles().none()]))
`)
  const output = jsonResult(invoke(workspace, data.file, '-r', 'json'), 1)
  const attempt = testNode(output).cases[0].attempts[0]
  expect(attempt.failures.map((failure) => failure.kind)).toEqual(['assertion', 'observation'])
  expect(attempt.property).toMatchObject({
    originalCounterexample: null,
    counterexample: null,
    stopped: 'execution-failed',
  })
})

test('worker property summary preserves the accepted counterexample after a passing shrink candidate', () => {
  const data = fixture(`
import { tuples, integers } from ${JSON.stringify(workspaceRuntime)}
export const root = new Test().target(x => x)
  .property('small', p => p.forAll(tuples(integers({min: 0, max: 100})), { seed: 42 }).steps(s => s.target.args(s.input[0])).expect(e => [e.on(e.result).satisfies('small', x => x < 5)]))
`)
  const output = jsonResult(invoke(workspace, data.file, '-r', 'json'), 1)
  const attempt = testNode(output).cases[0].attempts[0]
  expect(attempt.evaluations?.at(-1)?.status).toBe('passed')
  expect(attempt.assertions.map((assertion) => assertion.status)).toEqual(['failed'])
  expect(attempt.outcome).toMatchObject({ kind: 'return', value: { kind: 'number', value: 5 } })
  expect(attempt.operations?.[0]).toMatchObject({ status: 'returned', value: { kind: 'number', value: 5 } })
  const selected = attempt.assertions[0].failureIndexes[0]
  expect(attempt.failures[selected]).toMatchObject({ kind: 'assertion', actual: { kind: 'number', value: 5 } })
})
