import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as v from 'valibot'
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'
import {
  cases,
  childTest,
  consumerFixture,
  execute,
  groupNode,
  installPackage,
  interrupt,
  invoke,
  jsonResult,
  launcher,
  middlewareOf,
  removePackage,
  repository,
  runResult,
  runtime,
  testNode,
} from './harness.ts'
import type { InstalledPackage } from './harness.ts'

let installed: InstalledPackage

beforeAll(() => {
  installed = installPackage()
})
afterAll(() => {
  removePackage(installed)
})

test('installed CLI needs no module or TypeScript config and supports optional guide typechecking', () => {
  const project = join(installed.root, 'readme-start')
  const source = join(project, 'src')
  mkdirSync(source, { recursive: true })
  const packageDirectory = join(installed.consumer, 'node_modules/hanamaru')
  const guide = readFileSync(join(packageDirectory, 'docs/guides/getting-started.md'), 'utf8')
  const release = v.parse(
    v.object({ version: v.string() }),
    JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8')),
  )
  const [manifest, config] = [...guide.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => match[1])
  expect.assert(manifest !== undefined && config !== undefined)
  writeFileSync(join(project, 'package.json'), JSON.stringify({ private: true }))
  cpSync(join(installed.consumer, 'examples/math.ts'), join(source, 'math.ts'))
  cpSync(join(installed.consumer, 'examples/math.test.ts'), join(source, 'math.test.ts'))
  const install = execute(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--save-dev',
      join(installed.root, `hanamaru-${release.version}.tgz`),
    ],
    project,
    120_000,
  )
  expect(install.status, install.stderr).toBe(0)
  const help = execute('npx', ['--no-install', 'hanamaru', '--help'], project)
  expect(help.status, help.stderr).toBe(0)
  expect(help.stdout).toContain('hanamaru [files...]')
  const version = execute('npx', ['--no-install', 'hanamaru', '--version'], project)
  expect(version.status, version.stderr).toBe(0)
  expect(version.stdout.trim()).toBe(release.version)
  const output = jsonResult(
    execute('npx', ['--no-install', 'hanamaru', 'src/math.test.ts', '--reporter', 'json'], project),
    0,
  )
  expect(output.status).toBe('passed')
  expect(testNode(output).cases).toHaveLength(1)
  const projectManifest = v.parse(v.looseObject({}), JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')))
  const scripts = v.parse(v.object({ scripts: v.record(v.string(), v.string()) }), JSON.parse(manifest))
  writeFileSync(join(project, 'package.json'), JSON.stringify({ ...projectManifest, ...scripts }))
  writeFileSync(join(project, 'tsconfig.json'), config)
  const typeScript = execute(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-dev', 'typescript@5.8.3'],
    project,
    120_000,
  )
  expect(typeScript.status, typeScript.stderr).toBe(0)
  const passed = execute('npm', ['test'], project)
  expect(passed.status, passed.stdout + passed.stderr).toBe(0)
  expect(passed.stdout).toContain('2つの数を足す')
  const testFile = join(source, 'math.test.ts')
  writeFileSync(testFile, readFileSync(testFile, 'utf8').replace('toBe(3)', 'toBe(4)'))
  const failed = execute('npm', ['test'], project)
  expect(failed.status, failed.stdout + failed.stderr).toBe(1)
  expect(failed.stdout).toContain('toBe')
})

test(`installed public API satisfies lifecycle and result contracts on ${runtime}`, () => {
  const result = execute(launcher.command, [...launcher.args, 'library.ts'], installed.consumer)
  expect(result.status, result.stderr).toBe(0)
  expect(v.parse(v.object({ status: v.string(), runtime: v.string() }), JSON.parse(result.stdout))).toStrictEqual({
    status: 'passed',
    runtime,
  })
})

test('installed declarations satisfy the public positive and negative type contracts', () => {
  const contracts = join(installed.consumer, 'type-contracts')
  cpSync(join(repository, 'docs/spec'), contracts, { recursive: true })
  // pathsを外すと'hanamaru'はインストール済みパッケージの型定義に解決される。
  const config = v.parse(
    v.looseObject({ compilerOptions: v.looseObject({}) }),
    JSON.parse(readFileSync(join(contracts, 'tsconfig.json'), 'utf8')),
  )
  Reflect.deleteProperty(config.compilerOptions, 'paths')
  writeFileSync(join(contracts, 'tsconfig.json'), JSON.stringify(config))
  const checked = execute(
    process.execPath,
    [join(repository, 'node_modules/typescript/bin/tsc'), '-p', contracts],
    installed.consumer,
  )
  expect(checked.status, checked.stdout + checked.stderr).toBe(0)
})

test('installed CLI loads typed consumers and reports group, each, skip and todo results', () => {
  const output = jsonResult(invoke(installed.env, 'contracts.test.ts', '--reporter', 'json'), 0)
  expect(output.status).toBe('passed')
  expect(output.reason).toBe('completed')
  const root = groupNode(output)
  expect(root.name).toBe('contracts')
  const items = cases(root)
  expect(items.length).toBe(6)
  expect(items.slice(2, 4).map((item) => item.notRun)).toStrictEqual(['skipped', 'todo'])
  for (const item of items.slice(2, 4)) {
    expect(item.attempts).toStrictEqual([])
    expect(item.durationMs).toBe(0)
  }
  expect(
    items.slice(4).map((item) => {
      expect.assert(item.row !== null)
      return item.row.index
    }),
  ).toStrictEqual([0, 1])
  for (const item of items) {
    expect(item.origin.file).toBe(join(installed.consumer, 'contracts.test.ts'))
    expect(item.origin.line).toBeGreaterThan(0)
    expect(item.origin.column).toBeGreaterThan(0)
  }
})

test('CLI executes targets in the selected runtime', () => {
  const file = consumerFixture(
    installed,
    'runtime',
    `export const suite = new Test()
  .target(() => process.versions.bun ? 'bun' : process.versions.deno ? 'deno' : 'node')
  .it('runtime', t => t.args().expect(e => [e.result.toBe(${JSON.stringify(runtime)})]))`,
  )
  expect(jsonResult(invoke(installed.env, file, '--reporter', 'json'), 0).status).toBe('passed')
})

test('published documentation examples ship in the package and resolve hanamaru by name', () => {
  const output = jsonResult(invoke(installed.env, 'examples/math.test.ts', '--reporter', 'json', '--ci'), 0)
  expect(output.status).toBe('passed')
  const items = output.tests.flatMap(cases)
  expect(items.length).toBeGreaterThan(0)
  for (const item of items) expect(item.attempts.at(-1)?.status).toBe('passed')
})

test('CLI failures preserve matcher diagnostics and use exit code 1', () => {
  const file = consumerFixture(
    installed,
    'failure',
    `console.log('consumer log')
export const suite = new Test().target(() => 1).it('mismatch', t => t.args().expect(e => [e.result.toBe(2)]))`,
  )
  const result = invoke(installed.env, file, '--reporter', 'json')
  const output = jsonResult(result, 1)
  expect(result.stderr).toMatch(/consumer log/)
  expect(output.status).toBe('failed')
  const item = testNode(output).cases[0]
  expect(item.origin.file).toBe(file)
  const failure = item.attempts[0].failures[0]
  expect.assert(failure.kind === 'assertion')
  expect(failure.assertion.matcher).toBe('toBe')
  expect(failure.expected).toStrictEqual({ kind: 'number', value: 2 })
  expect(failure.actual).toStrictEqual({ kind: 'number', value: 1 })
})

test('installed comparisons follow Vitest for symbols and special values', () => {
  const file = consumerFixture(
    installed,
    'comparison-criteria',
    `
    const symbol = Symbol('id')
    export const suite = new Test().target((value: object) => value)
      .it('same symbol', t => t.args({ [symbol]: 1 }).expect(e => [e.result.toEqual({ [symbol]: 1 })]))
      .it('different symbols', t => t.args({ [Symbol('id')]: 1 }).expect(e => [e.result.toEqual({ [Symbol('id')]: 1 })]))
      .it('different dates', t => t.args({ at: new Date(0) }).expect(e => [e.result.toMatchObject({ at: new Date(1) })]))
      .it('map values', t => t.args({ m: new Map([[1, 2]]) }).expect(e => [e.result.toMatchObject({ m: new Map([[1, 3]]) })]))
      .it('set values', t => t.args({ s: new Set([1]) }).expect(e => [e.result.toMatchObject({ s: new Set([2]) })]))
      .it('regexp shape', t => t.args({ r: /x/g }).expect(e => [e.result.toMatchObject({ r: /y/i })]))
      .it('undefined field', t => t.args({ value: undefined }).expect(e => [e.result.toEqual({})]))
  `,
  )
  const output = jsonResult(invoke(installed.env, file, '--reporter', 'json'), 1)
  expect(testNode(output).cases.map((item) => item.attempts[0].status)).toStrictEqual([
    'passed',
    'failed',
    'failed',
    'failed',
    'failed',
    'passed',
    'passed',
  ])
})

test('installed CLI aborts after failed mock restoration', () => {
  const file = consumerFixture(
    installed,
    'failed-restoration',
    `
    const service = Object.defineProperty({}, 'read', { value: () => 1, configurable: false, writable: true })
    export const suite = new Test().retry(1).target(() => {
      Object.defineProperty(service, 'read', { writable: false })
      return service.read()
    }).it('locks mock', t => t.mock(service, 'read', m => m.returns(2)).args().expect(e => [e.result.toBe(2)]))
      .it('later', t => t.args().expect(e => [e.result.toBe(1)]))
  `,
  )
  const output = jsonResult(invoke(installed.env, file, '--reporter', 'json'), 1)
  expect(output.reason).toBe('cleanup-failed')
  const items = testNode(output).cases
  expect(items[0].attempts.length).toBe(1)
  expect(items[0].attempts[0].cleanup).toBe('incomplete')
  expect(items[1].notRun).toBe('cancelled')
})

test('CLI filtering retains original paths and rejects zero matches', () => {
  const file = consumerFixture(
    installed,
    'filter',
    `export const suite = new Test().target(n => n)
  .it('first', t => t.args(1).expect(e => [e.result.toBe(1)]))
  .it('second', t => t.args(2).expect(e => [e.result.toBe(2)]))`,
  )
  const output = jsonResult(invoke(installed.env, file, '--filter', 'second', '--reporter', 'json'), 0)
  expect(testNode(output).cases[0].path).toStrictEqual([0, 1])
  const missing = invoke(installed.env, file, '--filter', 'missing', '--reporter', 'json')
  expect(missing.status, missing.stderr).toBe(2)
  expect(missing.stdout).toBe('')
})

test('CLI --ci rejects only before filtering', () => {
  const file = consumerFixture(
    installed,
    'only',
    `export const suite = new Test().target(() => 1)
  .only('exclusive', t => t.args().expect(e => [e.result.toBe(1)]))
  .it('ordinary', t => t.args().expect(e => [e.result.toBe(1)]))`,
  )
  const result = invoke(installed.env, file, '--ci', '--filter', 'ordinary', '--reporter', 'json')
  expect(result.status, result.stderr).toBe(2)
  expect(result.stdout).toBe('')
  expect(result.stderr).toMatch(/only is forbidden/)
})

test('CLI retry records every attempt and fail-on-flaky changes the exit code', () => {
  const file = consumerFixture(
    installed,
    'retry',
    `let calls = 0
export const suite = new Test().retry(1).target(() => ++calls)
  .it('retry', t => t.args().expect(e => [e.result.toBe(2)]))`,
  )
  for (const [flags, code] of [
    [[], 0],
    [['--fail-on-flaky'], 1],
  ] as const) {
    const output = jsonResult(invoke(installed.env, file, '--reporter', 'json', ...flags), code)
    expect(output.status).toBe(code ? 'failed' : 'passed')
    expect(testNode(output).cases[0].attempts.map((attempt) => attempt.status)).toStrictEqual(['failed', 'passed'])
  }
})

test('CLI reads TypeScript config, discovers files and lets flags override the reporter', () => {
  consumerFixture(
    installed,
    'discovered.test',
    `export const suite = new Test().target(() => 1)
  .it('discovered', t => t.args().expect(e => [e.result.toBe(1)]))`,
  )
  const config = join(installed.consumer, 'hanamaru.config.ts')
  writeFileSync(
    config,
    `import { defineConfig } from 'hanamaru'
export default defineConfig({ projects: { discovered: { include: ['discovered.test.ts'] } }, reporter: 'json' })`,
  )
  expect(jsonResult(invoke(installed.env, '--config', config), 0).status).toBe('passed')
  const pretty = invoke(installed.env, '--config', config, '--reporter', 'pretty')
  expect(pretty.status, pretty.stderr).toBe(0)
  expect(pretty.stdout).toMatch(/✓ discovered/)
})

test('CLI resolves .js-to-.ts, extensionless imports and tsconfig aliases', () => {
  writeFileSync(join(installed.consumer, 'helper.ts'), 'export const value: number = 2\n')
  writeFileSync(
    join(installed.consumer, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@app/*': ['./*'] } } }),
  )
  const file = consumerFixture(
    installed,
    'resolution',
    `import { value as js } from './helper.js'
import { value as extensionless } from './helper'
import { value as alias } from '@app/helper'
export const suite = new Test().target(() => js + extensionless + alias)
  .it('resolution', t => t.args().expect(e => [e.result.toBe(6)]))`,
  )
  expect(jsonResult(invoke(installed.env, file, '--reporter', 'json'), 0).status).toBe('passed')
})

test('CLI collection errors do not invent a RunResult', () => {
  const file = consumerFixture(installed, 'incomplete', 'export const unfinished = new Test().target(() => 1)')
  for (const args of [[file], ['missing-file.ts'], [file, '--unknown']]) {
    const result = invoke(installed.env, ...args, '--reporter', 'json')
    expect(result.status, result.stderr).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr.length).toBeGreaterThan(0)
  }
})

test('CLI mocks direct and captured module imports and restores the real export', () => {
  writeFileSync(
    join(installed.consumer, 'module-service.ts'),
    'export function read(value: number) { return value * 2 }',
  )
  writeFileSync(
    join(installed.consumer, 'module-target.ts'),
    `import { read } from './module-service.ts'
const captured = read
export function readBoth() { return [read(1), captured(2)] }`,
  )
  const file = consumerFixture(
    installed,
    'module-mock',
    `import * as service from './module-service.ts'
import { readBoth } from './module-target.ts'
export const suite = new Test().target(readBoth)
  .it('mock', t => t.mock(service, 'read', m => m.returnsOnce(7).returns(8)).args()
    .expect(e => [e.result.toEqual([7, 8])])
    .expectCalls(call => [call(service, 'read').calledTimes(2), call(service, 'read').calledNthWith(2, 2)]))
  .it('real', t => t.args().expect(e => [e.result.toEqual([2, 4])]))`,
  )
  const output = jsonResult(invoke(installed.env, file, '--reporter', 'json'), 0)
  expect(output.status).toBe('passed')
  expect(testNode(output).cases.map((item) => item.attempts[0].status)).toStrictEqual(['passed', 'passed'])
})

test('CLI Vite aliases and function plugins preserve module mock contracts', () => {
  writeFileSync(join(installed.consumer, 'plugin-service.ts'), 'export function value(): number { return 2 }')
  const file = consumerFixture(
    installed,
    'plugin-mock',
    `import * as service from '@service'
import { read } from 'virtual:reader'
export const suite = new Test().target(read)
  .it('mock', t => t.mock(service, 'value', m => m.returns(9)).args().expect(e => [e.result.toBe(9)]))
  .it('real', t => t.args().expect(e => [e.result.toBe(2)]))`,
  )
  const config = join(installed.consumer, 'plugin.config.ts')
  writeFileSync(
    config,
    `export default {
  vite: {
    resolve: { alias: { '@service': ${JSON.stringify(join(installed.consumer, 'plugin-service.ts'))} } },
    plugins: [{
      name: 'reader',
      resolveId(id: string) { if (id === 'virtual:reader') return '\\0virtual:reader' },
      load(id: string) {
        if (id === '\\0virtual:reader') return "import { value } from '@service'; export function read() { return value() }"
      },
    }],
  },
}`,
  )
  const output = jsonResult(invoke(installed.env, file, '--config', config, '--reporter', 'json'), 0)
  expect(output.status).toBe('passed')
  expect(testNode(output).cases.map((item) => item.attempts[0].status)).toStrictEqual(['passed', 'passed'])
})

test('CLI terminates a stuck collection without creating a result', () => {
  const file = consumerFixture(installed, 'collection', 'await new Promise(() => {})')
  const result = invoke(installed.env, file, '--collection-timeout', '100', '--reporter', 'json')
  expect(result.status, result.stderr).toBe(2)
  expect(result.stdout).toBe('')
  expect(result.stderr).toMatch(/collection timeout/)
})

test('CLI timeout terminates stuck execution and reports incomplete cleanup', () => {
  const file = consumerFixture(
    installed,
    'timeout',
    `export const suite = new Test().timeout(100)
  .target(() => new Promise(() => {}))
  .it('stuck', t => t.args().expect(e => [e.result.toBe(1)]))
  .it('pending', t => t.args().expect(e => [e.result.toBe(1)]))`,
  )
  const result = invoke(installed.env, file, '--shutdown-grace', '100', '--reporter', 'json')
  const output = jsonResult(result, 1)
  expect(output.status).toBe('failed')
  expect(output.reason).toBe('timeout')
  const [active, pending] = testNode(output).cases
  expect(active.attempts[0].status).toBe('failed')
  expect(active.attempts[0].cleanup).toBe('incomplete')
  expect(active.attempts[0].failures[0].kind).toBe('timeout')
  expect(pending.notRun).toBe('cancelled')
  expect(pending.attempts).toStrictEqual([])
  expect(result.stderr).toMatch(/shutdown grace exceeded/)
})

test('CLI deadline terminates a synchronously blocked target', () => {
  const file = consumerFixture(
    installed,
    'blocked',
    `export const suite = new Test().timeout(100)
  .target(() => { while (true) {} })
  .it('blocked', t => t.args().expect(e => [e.result.toBe(1)]))`,
  )
  const output = jsonResult(invoke(installed.env, file, '--shutdown-grace', '100', '--reporter', 'json'), 1)
  expect(output.reason).toBe('timeout')
  expect(testNode(output).cases[0].attempts[0].cleanup).toBe('incomplete')
})

test('installed CLI terminates blocked group cleanup after a failed child', () => {
  for (const [name, cleanup] of [
    ['async', 'await new Promise(() => {})'],
    ['sync', 'while (true) {}'],
  ] as const) {
    const file = consumerFixture(
      installed,
      `failed-child-cleanup-${name}`,
      `
      const child = new Test().target(() => 1).it('fails', t => t.args().expect(e => [e.result.toBe(2)]))
      export const group = new Test().group(middleware(async (_, next) => {
        try { return await next() } finally { ${cleanup} }
      }, { timeout: 100 }), [child])
    `,
    )
    const output = jsonResult(invoke(installed.env, file, '--shutdown-grace', '100', '--reporter', 'json'), 1)
    expect(output.reason, name).toBe('timeout')
    const group = groupNode(output)
    expect(middlewareOf(group).status, name).toBe('failed')
    expect(middlewareOf(group).cleanup, name).toBe('incomplete')
    expect(middlewareOf(group).failures[0].phase, name).toBe('after')
    expect(childTest(group).cases[0].attempts[0].failures[0].kind, name).toBe('assertion')
  }
})

test('CLI Ctrl+C preserves completed and pending results around a blocked target and exits 130', async () => {
  const file = consumerFixture(
    installed,
    'interrupt',
    `export const suite = new Test().timeout(10000)
  .target(value => {
    if (value === 2) { console.error('target ready'); while (true) {} }
    return value
  })
  .it('completed', t => t.args(1).expect(e => [e.result.toBe(1)]))
  .it('interrupt', t => t.args(2).expect(e => [e.result.toBe(2)]))
  .it('pending', t => t.args(3).expect(e => [e.result.toBe(3)]))`,
  )
  const run = await interrupt(installed.env, [file, '--shutdown-grace', '100', '--reporter', 'json'], 'target ready')
  expect(run.interrupted, run.stderr).toBe(true)
  expect(run.signal, run.stderr).toBeNull()
  expect(run.code, run.stderr).toBe(130)
  const output = runResult(run.stdout)
  expect(output.status).toBe('cancelled')
  expect(output.reason).toBe('interrupted')
  const items = testNode(output).cases
  expect(items.map((item) => item.name)).toStrictEqual(['completed', 'interrupt', 'pending'])
  expect(items[0].attempts[0].status).toBe('passed')
  const attempt = items[1].attempts[0]
  expect(attempt.status).toBe('cancelled')
  expect(attempt.cleanup).toBe('incomplete')
  expect(items[2].notRun).toBe('cancelled')
  expect(items[2].attempts).toStrictEqual([])
})

test('installed CLI keeps diagnostic inspection failures separate from target outcomes', () => {
  const file = consumerFixture(
    installed,
    'inspection-regression',
    `
const target = () => new Proxy({}, { ownKeys() { throw new Error('inspection exploded') } })
export const cases = new Test().target(target).it('must throw', t => t.args().expect(e => [e.error.toThrow('inspection exploded')]))
`,
  )
  const result = jsonResult(invoke(installed.env, file, '-r', 'json'), 1)
  expect(testNode(result).cases[0].attempts[0].outcome).toMatchObject({ kind: 'return', value: { kind: 'omitted' } })
})

test('installed pretty reporter shows group setup causes and concrete error expectations', () => {
  const file = consumerFixture(
    installed,
    'failure-details',
    `
const child = new Test().target(() => 1).it('child', t => t.args().expect(e => [e.result.toBe(1)]))
export const group = new Test().group('database', middleware(async () => { throw new Error('DATABASE_CONNECTION_REFUSED') }), [child])
export const errors = new Test().target(() => { throw new Error('actual') }).it('message', t => t.args().expect(e => [e.error.toThrow('wanted-message')]))
`,
  )
  const result = invoke(installed.env, file, '-r', 'pretty')
  expect(result.status, result.stderr).toBe(1)
  expect(result.stdout).toContain('DATABASE_CONNECTION_REFUSED')
  expect(result.stdout).toContain('wanted-message')
})

test('installed CLI resolves dynamic fixture objects and namespace argument expectations', () => {
  writeFileSync(join(installed.consumer, 'dynamic-service.ts'), 'export const send = (id: number) => id\n')
  const file = consumerFixture(
    installed,
    'dynamic-calls',
    `
import * as service from './dynamic-service.ts'
import { send } from './dynamic-service.ts'
let setups = 0
const child = new Test().use(middleware(async (_, next) => {
  const client = { send(id: number) { return id } }
  const original = client.send
  try { return await next({client, id: ++setups}) }
  finally { if (client.send !== original) throw new Error('not restored') }
})).target((client: {send(id: number): number}, id: number) => client.send(id))
.it('fixture', t => t.retry(1).argsFrom(ctx => [ctx.client, ctx.id]).expect(e => [e.result.toBe(2)])
.expectCalls(call => [call.from(ctx => ctx.client, 'send').calledOnceWithFrom(ctx => [ctx.id])]))
export const fixtures = new Test().group('resources', [child])
export const namespace = new Test().use(middleware(async (_, next) => next({id: 7}))).target((id: number) => send(id))
.it('mock', t => t.mock(service, 'send', m => m.returns(42)).argsFrom(ctx => [ctx.id])
.expect(e => [e.result.toBe(42)]).expectCalls(call => [call(service, 'send').calledOnceWithFrom(ctx => [ctx.id])]))
.it('restore', t => t.argsFrom(ctx => [ctx.id]).expect(e => [e.result.toBe(e.ctx.id)])
.expectCalls(call => [call(service, 'send').calledNthWithFrom(1, ctx => [ctx.id])]))
`,
  )
  const result = jsonResult(invoke(installed.env, file, '-r', 'json'), 0)
  expect(childTest(groupNode(result)).cases[0].attempts).toHaveLength(2)
  expect(testNode(result, 1).cases.map((item) => item.attempts.at(-1)?.status)).toEqual(['passed', 'passed'])
})

test('installed resources are hoisted on the brain, shared across files and released after worker cleanup', () => {
  const trace = join(installed.consumer, 'resource-trace.txt')
  writeFileSync(
    join(installed.consumer, 'shared-resource.ts'),
    `
import { resource } from 'hanamaru'
import { appendFileSync } from 'node:fs'
import { threadId } from 'node:worker_threads'
const log = (s: string) => appendFileSync(${JSON.stringify(trace)}, s + '\\n')
export const db = resource({ name: 'db', scope: 'perRun', async setup(_, next) {
  log('db open')
  try { return await next({ dbUrl: 'db://test', brain: threadId }) } finally { log('db close') }
}})
export const schema = resource({ name: 'schema', scope: 'perWorker', require: [db], async setup(ctx, next) {
  log('schema open')
  try { return await next({ url: ctx.dbUrl + '/schema', brain: ctx.brain }) } finally { log('schema close') }
}})
`,
  )
  const files = ['resource-a', 'resource-b'].map((name) =>
    consumerFixture(
      installed,
      name,
      `
import { schema } from './shared-resource.ts'
import { appendFileSync } from 'node:fs'
import { threadId } from 'node:worker_threads'
export const suite = new Test().require(schema).group('group', middleware(async (ctx, next) => {
  if (ctx.brain === threadId) throw new Error('resource was not hoisted')
  try { return await next() } finally { appendFileSync(${JSON.stringify(trace)}, 'worker close\\n') }
}), [new Test<{url: string, brain: number}>().target((url: string) => url)
.it('uses schema', t => t.argsFrom(ctx => [ctx.url]).expect(e => [e.result.toBe('db://test/schema'), e.result.toSatisfy(() => !Object.hasOwn(e.ctx, 'dbUrl'))]))])
`,
    ),
  )
  const result = jsonResult(invoke(installed.env, ...files, '-r', 'json'), 0)
  expect(result.resources?.map((r) => [r.name, r.middleware.status])).toEqual([
    ['db', 'passed'],
    ['schema', 'passed'],
  ])
  expect(readFileSync(trace, 'utf8').trim().split('\n')).toEqual([
    'db open',
    'schema open',
    'worker close',
    'worker close',
    'schema close',
    'db close',
  ])
})

test('installed resource setup failure cancels dependent cases and reports its cause in JSON and pretty', () => {
  const file = consumerFixture(
    installed,
    'resource-failure',
    `
import { resource } from 'hanamaru'
const bad = resource({ name: 'database', scope: 'perRun', async setup() { throw new Error('RESOURCE_CONNECTION_REFUSED') } })
export const blocked = new Test().require(bad).target(() => 1).it('dependent', t => t.args().expect(e => [e.result.toBe(1)]))
export const independent = new Test().target(() => 1).it('independent', t => t.args().expect(e => [e.result.toBe(1)]))
`,
  )
  const result = jsonResult(invoke(installed.env, file, '-r', 'json'), 1)
  expect(testNode(result).cases[0].notRun).toBe('cancelled')
  expect(testNode(result, 1).cases[0].attempts[0].status).toBe('passed')
  expect(result.resources?.[0].middleware).toMatchObject({ status: 'failed', failures: [{ phase: 'before' }] })
  const pretty = invoke(installed.env, file, '-r', 'pretty')
  expect(pretty.status, pretty.stderr).toBe(1)
  expect(pretty.stdout).toContain('resource database')
  expect(pretty.stdout).toContain('RESOURCE_CONNECTION_REFUSED')
})

test('installed CLI rejects non-JSON resource values and only starts selected resources', () => {
  const file = consumerFixture(
    installed,
    'resource-data',
    `
import { resource } from 'hanamaru'
const invalid = resource({ name: 'invalid', scope: 'perRun', async setup(_, next) { return await next({ missing: undefined }) } })
export const suite = new Test().target(() => 1)
.it('bad', t => t.require(invalid).args().expect(e => [e.result.toBe(1)]))
.it('good', t => t.args().expect(e => [e.result.toBe(1)]))
`,
  )
  const result = jsonResult(invoke(installed.env, file, '-r', 'json'), 1)
  expect(result.resources?.[0].middleware.status).toBe('failed')
  expect(testNode(result).cases.map((c) => c.notRun ?? c.attempts[0].status)).toEqual(['cancelled', 'passed'])
  const filtered = jsonResult(invoke(installed.env, file, '--filter', 'good', '-r', 'json'), 0)
  expect(filtered.resources).toBeUndefined()
})

test('installed resource deadlines identify a blocked setup and a blocked teardown', () => {
  for (const stage of ['before', 'after']) {
    const file = consumerFixture(
      installed,
      `resource-timeout-${stage}`,
      `
import { resource } from 'hanamaru'
const stuck = resource({ name: 'stuck', scope: 'perRun', timeout: 50, async setup(_, next) {
  ${stage === 'before' ? 'while (true) {}' : 'try { return await next({ value: 1 }) } finally { while (true) {} }'}
}})
export const suite = new Test().require(stuck).target(() => 1).it('case', t => t.args().expect(e => [e.result.toBe(1)]))
`,
    )
    const result = jsonResult(invoke(installed.env, file, '--shutdown-grace', '50', '-r', 'json'), 1)
    expect(result).toMatchObject({ status: 'failed', reason: 'timeout' })
    expect(result.resources?.[0].middleware).toMatchObject({
      status: 'failed',
      cleanup: 'incomplete',
      failures: [{ kind: 'timeout', phase: stage }],
    })
  }
})
