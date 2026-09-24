import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, renameSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'

const cli = resolve('dist/cli.js')
const runtime = pathToFileURL(resolve('dist/index.js')).href
function fixture(source) {
  const dir = mkdtempSync(join(tmpdir(), 'hanamaru-cli-'))
  const file = join(dir, 'sample.test.mjs')
  writeFileSync(file, `import { Test, middleware } from ${JSON.stringify(runtime)}\n${source}`)
  return { dir, file, close: () => rmSync(dir, { recursive: true, force: true }) }
}
function invoke(...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: resolve('.'), encoding: 'utf8', timeout: 5000 })
}

test('CLI loads TS sample and emits one RunResult', () => {
  const result = invoke('docs/examples/math.test.ts', '--reporter', 'json')
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.status, 'passed')
  assert.equal(output.tests[0].cases[0].origin.file.endsWith('math.test.ts'), true)
})

test('CLI filter preserves source paths and rejects no matches', () => {
  const data = fixture(
    `export const cases = new Test().target((n) => n).it('one', t => t.args(1).expect(e => [e.result.toBe(1)])).it('two', t => t.args(2).expect(e => [e.result.toBe(2)]))`,
  )
  try {
    const selected = invoke(data.file, '-t', 'two', '-r', 'json')
    assert.equal(selected.status, 0, selected.stderr)
    assert.deepEqual(JSON.parse(selected.stdout).tests[0].cases[0].path, [0, 1])
    const missing = invoke(data.file, '-t', 'missing')
    assert.equal(missing.status, 2)
    assert.equal(missing.stdout, '')
  } finally {
    data.close()
  }
})

test('CLI --ci rejects only before filter', () => {
  const data = fixture(
    `export const cases = new Test().target((n) => n).only('exclusive', t => t.args(1).expect(e => [e.result.toBe(1)])).it('ordinary', t => t.args(2).expect(e => [e.result.toBe(2)]))`,
  )
  try {
    const result = invoke(data.file, '--ci', '--filter', 'ordinary')
    assert.equal(result.status, 2)
    assert.match(result.stderr, /only is forbidden/)
  } finally {
    data.close()
  }
})

test('CLI collection timeout stops a hanging import', () => {
  const data = fixture('await new Promise(() => {})')
  try {
    const result = invoke(data.file, '--collection-timeout', '20')
    assert.equal(result.status, 2)
    assert.match(result.stderr, /collection timeout/)
  } finally {
    data.close()
  }
})

test('CLI shutdown grace ends a stuck target', () => {
  const data = fixture(
    `export const cases = new Test().timeout(10).target(async () => new Promise(() => {})).it('hang', t => t.args().expect(e => [e.result.toBe(1)]))`,
  )
  try {
    const result = invoke(data.file, '--shutdown-grace', '20')
    assert.equal(result.status, 1)
    assert.match(result.stderr, /shutdown grace exceeded/)
  } finally {
    data.close()
  }
})

test('CLI resolves .js-to-.ts imports and tsconfig path aliases', () => {
  const data = fixture(
    `import { value as relativeValue } from './helper.js'\nimport { value as aliasedValue } from '@app/helper'\nexport const cases = new Test().target(() => relativeValue + aliasedValue).it('aliases', t => t.args().expect(e => [e.result.toBe(4)]))`,
  )
  try {
    writeFileSync(join(data.dir, 'helper.ts'), 'export const value = 2\n')
    writeFileSync(
      join(data.dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@app/*': ['./*'] } } }),
    )
    const result = invoke(data.file)
    assert.equal(result.status, 0, result.stderr)
  } finally {
    data.close()
  }
})

test('CLI reads config file and lets arguments override reporter', () => {
  const data = fixture(
    `export const cases = new Test().target(() => 1).it('one', t => t.args().expect(e => [e.result.toBe(1)]))`,
  )
  try {
    const configFile = join(data.dir, 'hanamaru.config.mjs')
    writeFileSync(configFile, `export default { reporter: 'json', collectionTimeout: 1000 }`)
    const configured = invoke(data.file, '--config', configFile)
    assert.equal(configured.status, 0, configured.stderr)
    assert.equal(JSON.parse(configured.stdout).status, 'passed')
    const overridden = invoke(data.file, '--config', configFile, '--reporter', 'pretty')
    assert.equal(overridden.status, 0, overridden.stderr)
    assert.match(overridden.stdout, /✓ one/)
  } finally {
    data.close()
  }
})

test('CLI forced timeout emits a partial RunResult with incomplete cleanup', () => {
  const data = fixture(
    `export const cases = new Test().timeout(10).target(async () => new Promise(() => {})).it('hang', t => t.args().expect(e => [e.result.toBe(1)]))`,
  )
  try {
    const result = invoke(data.file, '--shutdown-grace', '20', '--reporter', 'json')
    assert.equal(result.status, 1, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.equal(output.status, 'failed')
    assert.equal(output.reason, 'timeout')
    const attempt = output.tests[0].cases[0].attempts[0]
    assert.equal(attempt.status, 'failed')
    assert.equal(attempt.cleanup, 'incomplete')
    assert.equal(attempt.failures[0].kind, 'timeout')
  } finally {
    data.close()
  }
})

test('CLI partial result preserves completed cases before a forced stop', () => {
  const data = fixture(
    `export const cases = new Test().timeout(10).target(async n => n === 1 ? 1 : new Promise(() => {})).it('done', t => t.args(1).expect(e => [e.result.toBe(1)])).it('hang', t => t.args(2).expect(e => [e.result.toBe(2)]))`,
  )
  try {
    const result = invoke(data.file, '--shutdown-grace', '20', '--reporter', 'json')
    assert.equal(result.status, 1, result.stderr)
    const cases = JSON.parse(result.stdout).tests[0].cases
    assert.equal(cases[0].attempts[0].status, 'passed')
    assert.equal(cases[1].attempts[0].status, 'failed')
    assert.equal(cases[1].attempts[0].cleanup, 'incomplete')
  } finally {
    data.close()
  }
})

test('declaration locations point to user test files inside src directories', () => {
  const data = fixture(
    `export const cases = new Test().target(() => 1).it('one', t => t.args().expect(e => [e.result.toBe(1)]))`,
  )
  try {
    const sourceDir = join(data.dir, 'src')
    mkdirSync(sourceDir)
    const moved = join(sourceDir, 'sample.test.mjs')
    renameSync(data.file, moved)
    const result = invoke(moved, '--reporter', 'json')
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).tests[0].cases[0].origin.file, moved)
  } finally {
    data.close()
  }
})

test('CLI parent stops a synchronously blocked target at its deadline', () => {
  const data = fixture(
    `export const cases = new Test().timeout(10).target(() => { while (true) {} }).it('blocked', t => t.args().expect(e => [e.result.toBe(1)]))`,
  )
  try {
    const result = invoke(data.file, '--shutdown-grace', '20', '--reporter', 'json')
    assert.equal(result.status, 1, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.equal(output.reason, 'timeout')
    assert.equal(output.tests[0].cases[0].attempts[0].cleanup, 'incomplete')
  } finally {
    data.close()
  }
})

test('CLI parent stops a synchronously blocked group preprocessor', () => {
  const data = fixture(
    `const child = new Test().target(() => 1).it('never', t => t.args().expect(e => [e.result.toBe(1)]))\nexport const group = new Test().group(middleware(async () => { while (true) {} }, { timeout: 10 }), [child])`,
  )
  try {
    const result = invoke(data.file, '--shutdown-grace', '20', '--reporter', 'json')
    assert.equal(result.status, 1, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.equal(output.reason, 'timeout')
    assert.equal(output.tests[0].middleware.status, 'failed')
    assert.equal(output.tests[0].children[0].result.cases[0].notRun, 'cancelled')
  } finally {
    data.close()
  }
})

test('CLI Ctrl+C stops a blocked target and exits 130', async () => {
  const data = fixture(
    `export const cases = new Test().timeout(10000).target(() => { console.error('TARGET_STARTED'); while (true) {} }).it('blocked', t => t.args().expect(e => [e.result.toBe(1)]))`,
  )
  try {
    const child = spawn(process.execPath, [cli, data.file, '--shutdown-grace', '20', '--reporter', 'json'], {
      cwd: resolve('.'),
    })
    let stdout = '',
      stderr = '',
      signalled = false
    const code = await new Promise((resolveExit, reject) => {
      const safety = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error('CLI did not stop'))
      }, 5000)
      child.stdout.on('data', (chunk) => {
        stdout += chunk
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk
        if (!signalled && stderr.includes('TARGET_STARTED')) {
          signalled = true
          child.kill('SIGINT')
        }
      })
      child.on('exit', (value) => {
        clearTimeout(safety)
        resolveExit(value)
      })
      child.on('error', (error) => {
        clearTimeout(safety)
        reject(error)
      })
    })
    assert.equal(code, 130, stderr)
    const result = JSON.parse(stdout)
    assert.equal(result.reason, 'interrupted')
    assert.equal(result.tests[0].cases[0].attempts[0].status, 'cancelled')
  } finally {
    data.close()
  }
})
