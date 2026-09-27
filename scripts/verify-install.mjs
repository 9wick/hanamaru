import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// Runs against the packed artifact, never workspace imports. Requires npm registry access.
const scratch = mkdtempSync(join(tmpdir(), 'hanamaru-install-'))
const runtimes = process.argv.slice(2)
if (!runtimes.length) runtimes.push(process.execPath)
function command(executable, args, cwd, timeout = 60_000) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', timeout })
  assert.equal(
    result.status,
    0,
    `${executable} ${args.join(' ')}\n${result.error ?? ''}\n${result.stdout}\n${result.stderr}`,
  )
  return result.stdout
}
try {
  const packed = JSON.parse(
    command('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], resolve('.')),
  )
  const tarball = join(scratch, packed[0].filename)
  for (const project of ['plain', 'vite6']) {
    const cwd = join(scratch, project)
    mkdirSync(cwd)
    writeFileSync(
      join(cwd, 'package.json'),
      JSON.stringify({ name: `consumer-${project}`, private: true, type: 'module' }),
    )
    command(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        tarball,
        'typescript@5.8.3',
        ...(project === 'vite6' ? ['vite@6.4.0'] : []),
      ],
      cwd,
    )
    writeFileSync(join(cwd, 'data.ts'), 'export function getData(): number { return 2 }')
    writeFileSync(
      join(cwd, 'calc.ts'),
      "import { getData } from './data.ts'; export function calc() { return getData() * 2 }",
    )
    const commonjs = join(cwd, 'node_modules/cjs-data')
    mkdirSync(commonjs)
    writeFileSync(
      join(commonjs, 'package.json'),
      JSON.stringify({ name: 'cjs-data', main: 'index.js', types: 'index.d.ts' }),
    )
    writeFileSync(join(commonjs, 'index.js'), 'exports.getData = () => 2')
    writeFileSync(join(commonjs, 'index.d.ts'), 'export declare function getData(): number')
    const setup = project === 'plain' ? "import { calc } from './calc.ts'" : "import { calc } from 'virtual:calc'"
    writeFileSync(
      join(cwd, 'sample.test.ts'),
      `
import { Test } from 'hanamaru'
import * as data from './data.ts'
import * as cjsData from 'cjs-data'
import { getData as cjsGet } from 'cjs-data'
${setup}
export const cases = new Test().target(calc)
  .it('mock', t => t.mock(data, 'getData', m => m.returns(9)).args()
    .expect(e => [e.result.toBe(18)]).expectCalls(call => [call(data, 'getData').calledOnceWith()]))
  .it('restored', t => t.args().expect(e => [e.result.toBe(4)])
    .expectCalls(call => [call(data, 'getData').calledOnceWith()]))
export const cjsCases = new Test().target(() => cjsGet())
  .it('mock', t => t.mock(cjsData, 'getData', m => m.returns(9)).args().expect(e => [e.result.toBe(9)]))
  .it('restored', t => t.args().expect(e => [e.result.toBe(2)]))
`,
    )
    if (project === 'vite6') {
      writeFileSync(join(cwd, 'vite.config.ts'), "throw new Error('unrequested Vite config was loaded')")
      writeFileSync(
        join(cwd, 'hanamaru.config.ts'),
        `
import { defineConfig } from 'hanamaru'
export default defineConfig({ vite: {
  resolve: { alias: { '@data': new URL('./data.ts', import.meta.url).pathname } },
  plugins: [{ name: 'virtual-calc',
    resolveId(id) { if (id === 'virtual:calc') return '\\0virtual:calc' },
    load(id) { if (id === '\\0virtual:calc') return "import { getData } from '@data'; export function calc() { return getData() * 2 }" },
  }],
} })
`,
      )
      writeFileSync(join(cwd, 'virtual.d.ts'), "declare module 'virtual:calc' { export function calc(): number }")
    }
    writeFileSync(
      join(cwd, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          target: 'ES2022',
          strict: true,
          noEmit: true,
          allowImportingTsExtensions: true,
        },
        include: ['sample.test.ts', 'data.ts', 'calc.ts', 'hanamaru.config.ts', 'virtual.d.ts'],
      }),
    )
    command(process.execPath, [join(cwd, 'node_modules/typescript/bin/tsc'), '--noEmit'], cwd)
    for (const runtime of runtimes) {
      const cli = join(cwd, 'node_modules/hanamaru/dist/cli.js')
      const args = basename(runtime).startsWith('deno')
        ? ['run', '-A', '--node-modules-dir=manual', cli, '-r', 'json']
        : [cli, '-r', 'json']
      const result = JSON.parse(command(runtime, args, cwd, 20_000))
      assert.equal(result.status, 'passed')
      assert.equal(
        result.tests.reduce((count, test) => count + test.cases.length, 0),
        4,
      )
      console.log(JSON.stringify({ project, runtime, status: result.status, cases: 4, typecheck: 'passed' }))
    }
    if (project === 'vite6') {
      assert.equal(JSON.parse(readFileSync(join(cwd, 'node_modules/vite/package.json'))).version, '6.4.0')
      console.log('Consumer Vite 6.4.0 retained; hanamaru uses its own Vite dependency.')
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
