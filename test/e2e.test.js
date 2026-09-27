import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'

const runtime = process.env.HANAMARU_RUNTIME ?? 'node'
const runtimes = {
  node: { command: process.execPath, args: [] },
  bun: { command: 'bun', args: [] },
  deno: { command: 'deno', args: ['run', '--allow-all', '--no-prompt', '--node-modules-dir=manual', '--no-lock'] },
}
assert.ok(Object.hasOwn(runtimes, runtime), `unknown HANAMARU_RUNTIME: ${runtime}`)
const selected = runtimes[runtime]
const repository = resolve('.')
let workspace, consumer, cli

function execute(command, args, cwd = consumer, timeout = 15_000) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 1024 * 1024 })
  assert.ifError(result.error)
  assert.equal(result.signal, null, `${command} did not exit normally: ${result.stderr}`)
  return result
}
function invoke(...args) {
  return execute(selected.command, [...selected.args, cli, ...args])
}
function jsonResult(result, code) {
  assert.equal(result.status, code, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.version, 1)
  return output
}
function fixture(name, source) {
  const file = join(consumer, `${name}.ts`)
  writeFileSync(file, `import { Test, middleware } from 'hanamaru'\n${source}\n`)
  return file
}
function cases(node) {
  return node.kind === 'group' ? node.children.flatMap((child) => cases(child.result)) : node.cases
}

before(() => {
  workspace = mkdtempSync(join(tmpdir(), 'hanamaru-package-'))
  consumer = join(workspace, 'consumer')
  cpSync(resolve('test/fixtures/e2e'), consumer, { recursive: true })
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  const packed = execute('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', workspace], repository)
  assert.equal(packed.status, 0, packed.stderr)
  const [{ filename }] = JSON.parse(packed.stdout)
  const installed = execute(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(workspace, filename)],
    consumer,
    120_000,
  )
  assert.equal(installed.status, 0, installed.stderr)
  const packageDirectory = join(consumer, 'node_modules/hanamaru')
  const manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'))
  cli = join(packageDirectory, manifest.bin.hanamaru)
  cpSync(join(packageDirectory, 'docs/examples'), join(consumer, 'examples'), { recursive: true })
})
after(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true })
})

test(`installed public API satisfies lifecycle and result contracts on ${runtime}`, () => {
  const result = execute(selected.command, [...selected.args, 'library.ts'])
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { status: 'passed', runtime })
})

test('installed declarations satisfy the public positive and negative type contracts', () => {
  const contracts = join(consumer, 'type-contracts')
  cpSync(resolve('docs/spec'), contracts, { recursive: true })
  const config = JSON.parse(readFileSync(join(contracts, 'tsconfig.json'), 'utf8'))
  delete config.compilerOptions.paths
  writeFileSync(join(contracts, 'tsconfig.json'), JSON.stringify(config))
  const checked = execute(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '-p', contracts])
  assert.equal(checked.status, 0, checked.stdout + checked.stderr)
})

test('installed CLI loads typed consumers and reports group, each, skip and todo results', () => {
  const output = jsonResult(invoke('contracts.test.ts', '--reporter', 'json'), 0)
  assert.equal(output.status, 'passed')
  assert.equal(output.reason, 'completed')
  assert.equal(output.tests[0].name, 'contracts')
  const items = cases(output.tests[0])
  assert.equal(items.length, 6)
  assert.deepEqual(
    items.slice(2, 4).map((item) => item.notRun),
    ['skipped', 'todo'],
  )
  for (const item of items.slice(2, 4)) {
    assert.deepEqual(item.attempts, [])
    assert.equal(item.durationMs, 0)
  }
  assert.deepEqual(
    items.slice(4).map((item) => item.row.index),
    [0, 1],
  )
  for (const item of items) {
    assert.equal(item.origin.file, join(consumer, 'contracts.test.ts'))
    assert.ok(item.origin.line > 0)
    assert.ok(item.origin.column > 0)
  }
})

test('CLI executes targets in the selected runtime', () => {
  const file = fixture(
    'runtime',
    `export const suite = new Test()
  .target(() => process.versions.bun ? 'bun' : process.versions.deno ? 'deno' : 'node')
  .it('runtime', t => t.args().expect(e => [e.result.toBe(${JSON.stringify(runtime)})]))`,
  )
  assert.equal(jsonResult(invoke(file, '--reporter', 'json'), 0).status, 'passed')
})

test('published documentation examples run through the installed package', () => {
  const output = jsonResult(
    invoke(
      'examples/math.test.ts',
      'examples/user.test.ts',
      'examples/calls.test.ts',
      'examples/each.test.ts',
      'examples/groups.test.ts',
      'examples/middleware.test.ts',
      'examples/execution-options.test.ts',
      '--reporter',
      'json',
      '--ci',
    ),
    0,
  )
  assert.equal(output.status, 'passed')
  const items = output.tests.flatMap(cases)
  assert.ok(items.length >= 7)
  assert.ok(items.every((item) => item.attempts.at(-1).status === 'passed'))
})

test('CLI failures preserve matcher diagnostics and use exit code 1', () => {
  const file = fixture(
    'failure',
    `console.log('consumer log')
export const suite = new Test().target(() => 1).it('mismatch', t => t.args().expect(e => [e.result.toBe(2)]))`,
  )
  const result = invoke(file, '--reporter', 'json')
  const output = jsonResult(result, 1)
  assert.match(result.stderr, /consumer log/)
  assert.equal(output.status, 'failed')
  const item = output.tests[0].cases[0]
  assert.equal(item.origin.file, file)
  const failure = item.attempts[0].failures[0]
  assert.equal(failure.kind, 'assertion')
  assert.equal(failure.assertion.matcher, 'toBe')
  assert.deepEqual(failure.expected, { kind: 'number', value: 2 })
  assert.deepEqual(failure.actual, { kind: 'number', value: 1 })
})

test('installed comparisons follow Vitest for symbols and special values', () => {
  const file = fixture(
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
  const output = jsonResult(invoke(file, '--reporter', 'json'), 1)
  assert.deepEqual(
    output.tests[0].cases.map((item) => item.attempts[0].status),
    ['passed', 'failed', 'failed', 'failed', 'failed', 'passed', 'passed'],
  )
})

test('installed CLI aborts after failed mock restoration', () => {
  const file = fixture(
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
  const output = jsonResult(invoke(file, '--reporter', 'json'), 1)
  assert.equal(output.reason, 'cleanup-failed')
  assert.equal(output.tests[0].cases[0].attempts.length, 1)
  assert.equal(output.tests[0].cases[0].attempts[0].cleanup, 'incomplete')
  assert.equal(output.tests[0].cases[1].notRun, 'cancelled')
})

test('CLI filtering retains original paths and rejects zero matches', () => {
  const file = fixture(
    'filter',
    `export const suite = new Test().target(n => n)
  .it('first', t => t.args(1).expect(e => [e.result.toBe(1)]))
  .it('second', t => t.args(2).expect(e => [e.result.toBe(2)]))`,
  )
  const output = jsonResult(invoke(file, '--filter', 'second', '--reporter', 'json'), 0)
  assert.deepEqual(output.tests[0].cases[0].path, [0, 1])
  const missing = invoke(file, '--filter', 'missing', '--reporter', 'json')
  assert.equal(missing.status, 2, missing.stderr)
  assert.equal(missing.stdout, '')
})

test('CLI --ci rejects only before filtering', () => {
  const file = fixture(
    'only',
    `export const suite = new Test().target(() => 1)
  .only('exclusive', t => t.args().expect(e => [e.result.toBe(1)]))
  .it('ordinary', t => t.args().expect(e => [e.result.toBe(1)]))`,
  )
  const result = invoke(file, '--ci', '--filter', 'ordinary', '--reporter', 'json')
  assert.equal(result.status, 2, result.stderr)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /only is forbidden/)
})

test('CLI retry records every attempt and fail-on-flaky changes the exit code', () => {
  const file = fixture(
    'retry',
    `let calls = 0
export const suite = new Test().retry(1).target(() => ++calls)
  .it('retry', t => t.args().expect(e => [e.result.toBe(2)]))`,
  )
  for (const [flags, code] of [
    [[], 0],
    [['--fail-on-flaky'], 1],
  ]) {
    const output = jsonResult(invoke(file, '--reporter', 'json', ...flags), code)
    assert.equal(output.status, code ? 'failed' : 'passed')
    assert.deepEqual(
      output.tests[0].cases[0].attempts.map((attempt) => attempt.status),
      ['failed', 'passed'],
    )
  }
})

test('CLI reads TypeScript config, discovers files and lets flags override the reporter', () => {
  fixture(
    'discovered.test',
    `export const suite = new Test().target(() => 1)
  .it('discovered', t => t.args().expect(e => [e.result.toBe(1)]))`,
  )
  const config = join(consumer, 'hanamaru.config.ts')
  writeFileSync(
    config,
    `import { defineConfig } from 'hanamaru'
export default defineConfig({ include: ['discovered.test.ts'], reporter: 'json' })`,
  )
  assert.equal(jsonResult(invoke('--config', config), 0).status, 'passed')
  const pretty = invoke('--config', config, '--reporter', 'pretty')
  assert.equal(pretty.status, 0, pretty.stderr)
  assert.match(pretty.stdout, /✓ discovered/)
})

test('CLI resolves .js-to-.ts, extensionless imports and tsconfig aliases', () => {
  writeFileSync(join(consumer, 'helper.ts'), 'export const value: number = 2\n')
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@app/*': ['./*'] } } }),
  )
  const file = fixture(
    'resolution',
    `import { value as js } from './helper.js'
import { value as extensionless } from './helper'
import { value as alias } from '@app/helper'
export const suite = new Test().target(() => js + extensionless + alias)
  .it('resolution', t => t.args().expect(e => [e.result.toBe(6)]))`,
  )
  assert.equal(jsonResult(invoke(file, '--reporter', 'json'), 0).status, 'passed')
})

test('CLI collection errors do not invent a RunResult', () => {
  const file = fixture('incomplete', 'export const unfinished = new Test().target(() => 1)')
  for (const args of [[file], ['missing-file.ts'], [file, '--unknown']]) {
    const result = invoke(...args, '--reporter', 'json')
    assert.equal(result.status, 2, result.stderr)
    assert.equal(result.stdout, '')
    assert.ok(result.stderr.length > 0)
  }
})

test('CLI mocks direct and captured module imports and restores the real export', () => {
  writeFileSync(join(consumer, 'module-service.ts'), 'export function read(value: number) { return value * 2 }')
  writeFileSync(
    join(consumer, 'module-target.ts'),
    `import { read } from './module-service.ts'
const captured = read
export function readBoth() { return [read(1), captured(2)] }`,
  )
  const file = fixture(
    'module-mock',
    `import * as service from './module-service.ts'
import { readBoth } from './module-target.ts'
export const suite = new Test().target(readBoth)
  .it('mock', t => t.mock(service, 'read', m => m.returnsOnce(7).returns(8)).args()
    .expect(e => [e.result.toEqual([7, 8])])
    .expectCalls(call => [call(service, 'read').calledTimes(2), call(service, 'read').calledNthWith(2, 2)]))
  .it('real', t => t.args().expect(e => [e.result.toEqual([2, 4])]))`,
  )
  const output = jsonResult(invoke(file, '--reporter', 'json'), 0)
  assert.equal(output.status, 'passed')
  assert.deepEqual(
    output.tests[0].cases.map((item) => item.attempts[0].status),
    ['passed', 'passed'],
  )
})

test('CLI Vite aliases and function plugins preserve module mock contracts', () => {
  writeFileSync(join(consumer, 'plugin-service.ts'), 'export function value(): number { return 2 }')
  const file = fixture(
    'plugin-mock',
    `import * as service from '@service'
import { read } from 'virtual:reader'
export const suite = new Test().target(read)
  .it('mock', t => t.mock(service, 'value', m => m.returns(9)).args().expect(e => [e.result.toBe(9)]))
  .it('real', t => t.args().expect(e => [e.result.toBe(2)]))`,
  )
  const config = join(consumer, 'plugin.config.ts')
  writeFileSync(
    config,
    `export default {
  vite: {
    resolve: { alias: { '@service': ${JSON.stringify(join(consumer, 'plugin-service.ts'))} } },
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
  const output = jsonResult(invoke(file, '--config', config, '--reporter', 'json'), 0)
  assert.equal(output.status, 'passed')
  assert.deepEqual(
    output.tests[0].cases.map((item) => item.attempts[0].status),
    ['passed', 'passed'],
  )
})

test('CLI terminates a stuck collection without creating a result', () => {
  const file = fixture('collection', 'await new Promise(() => {})')
  const result = invoke(file, '--collection-timeout', '100', '--reporter', 'json')
  assert.equal(result.status, 2, result.stderr)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /collection timeout/)
})

test('CLI timeout terminates stuck execution and reports incomplete cleanup', () => {
  const file = fixture(
    'timeout',
    `export const suite = new Test().timeout(100)
  .target(() => new Promise(() => {}))
  .it('stuck', t => t.args().expect(e => [e.result.toBe(1)]))
  .it('pending', t => t.args().expect(e => [e.result.toBe(1)]))`,
  )
  const result = invoke(file, '--shutdown-grace', '100', '--reporter', 'json')
  const output = jsonResult(result, 1)
  assert.equal(output.status, 'failed')
  assert.equal(output.reason, 'timeout')
  const [active, pending] = output.tests[0].cases
  assert.equal(active.attempts[0].cleanup, 'incomplete')
  assert.equal(active.attempts[0].failures[0].kind, 'timeout')
  assert.equal(pending.notRun, 'cancelled')
  assert.deepEqual(pending.attempts, [])
  assert.match(result.stderr, /shutdown grace exceeded/)
})

test('CLI deadline terminates a synchronously blocked target', () => {
  const file = fixture(
    'blocked',
    `export const suite = new Test().timeout(100)
  .target(() => { while (true) {} })
  .it('blocked', t => t.args().expect(e => [e.result.toBe(1)]))`,
  )
  const output = jsonResult(invoke(file, '--shutdown-grace', '100', '--reporter', 'json'), 1)
  assert.equal(output.reason, 'timeout')
  assert.equal(output.tests[0].cases[0].attempts[0].cleanup, 'incomplete')
})

test('installed CLI terminates blocked group cleanup after a failed child', () => {
  for (const [name, cleanup] of [
    ['async', 'await new Promise(() => {})'],
    ['sync', 'while (true) {}'],
  ]) {
    const file = fixture(
      `failed-child-cleanup-${name}`,
      `
      const child = new Test().target(() => 1).it('fails', t => t.args().expect(e => [e.result.toBe(2)]))
      export const group = new Test().group(middleware(async (_, next) => {
        try { return await next() } finally { ${cleanup} }
      }, { timeout: 100 }), [child])
    `,
    )
    const output = jsonResult(invoke(file, '--shutdown-grace', '100', '--reporter', 'json'), 1)
    assert.equal(output.reason, 'timeout')
    assert.equal(output.tests[0].middleware.cleanup, 'incomplete')
    assert.equal(output.tests[0].middleware.failures[0].phase, 'after')
    assert.equal(output.tests[0].children[0].result.cases[0].attempts[0].failures[0].kind, 'assertion')
  }
})

test('CLI Ctrl+C interrupts a blocked target and exits 130', { timeout: 15_000 }, async (t) => {
  const file = fixture(
    'interrupt',
    `export const suite = new Test()
  .target(() => { console.error('target ready'); while (true) {} })
  .it('interrupt', t => t.args().expect(e => [e.result.toBe(1)]))`,
  )
  const child = spawn(
    selected.command,
    [...selected.args, cli, file, '--shutdown-grace', '100', '--reporter', 'json'],
    {
      cwd: consumer,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  t.after(() => child.kill('SIGKILL'))
  let stdout = '',
    stderr = '',
    interrupted = false
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
    if (!interrupted && stderr.includes('target ready')) {
      interrupted = true
      child.kill('SIGINT')
    }
  })
  const [code, signal] = await once(child, 'close')
  assert.equal(interrupted, true, stderr)
  assert.equal(signal, null, stderr)
  assert.equal(code, 130, stderr)
  const output = JSON.parse(stdout)
  assert.equal(output.status, 'cancelled')
  assert.equal(output.reason, 'interrupted')
  assert.equal(output.tests[0].cases[0].attempts[0].cleanup, 'incomplete')
})
