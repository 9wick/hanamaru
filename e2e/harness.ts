import { spawn, spawnSync } from 'node:child_process'
import type { SpawnSyncReturns } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as v from 'valibot'
import { expect, onTestFinished } from 'vite-plus/test'
import type {
  MutableCaseResult,
  MutableGroupMiddleware,
  MutableGroupResult,
  MutableNodeResult,
  MutableTestResult,
} from '../src/internal.ts'
import { runResultSchema } from '../src/schemas.ts'

export const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** CLIの起動方法。argsはCLIパスまでの固定引数で、テストごとの引数はその後ろに続く。 */
export interface CliEnvironment {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
}

// cwdをリポジトリルートにするのは、一時ディレクトリに置いたfixtureからでもhanamaruとviteのnode_modulesを解決させるため。
export const workspace: CliEnvironment = {
  command: process.execPath,
  args: [join(repository, 'dist/cli.js')],
  cwd: repository,
}
/** workspaceのfixtureがhanamaruを読み込む指定子。 */
export const workspaceRuntime = pathToFileURL(join(repository, 'dist/index.js')).href

export const runtime = v.parse(v.picklist(['node', 'bun', 'deno']), process.env.HANAMARU_RUNTIME ?? 'node')
const launchers: Record<typeof runtime, { command: string; args: string[] }> = {
  node: { command: process.execPath, args: [] },
  bun: { command: 'bun', args: [] },
  deno: { command: 'deno', args: ['run', '--allow-all', '--no-prompt', '--node-modules-dir=manual', '--no-lock'] },
}
export const launcher = launchers[runtime]

export function execute(
  command: string,
  args: readonly string[],
  cwd: string,
  timeout = 15_000,
): SpawnSyncReturns<string> {
  const result = spawnSync(command, [...args], { cwd, encoding: 'utf8', timeout, maxBuffer: 1024 * 1024 })
  expect(result.error?.message, command).toBeUndefined()
  expect(result.signal, `${command} did not exit normally: ${result.stderr}`).toBeNull()
  return result
}
export function invoke(env: CliEnvironment, ...args: string[]): SpawnSyncReturns<string> {
  return execute(env.command, [...env.args, ...args], env.cwd)
}

export interface InterruptedRun {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
  readonly interrupted: boolean
}
/** markerがstderrに現れたらSIGINTを送り、終了するまでの出力と終了状態を返す。 */
export async function interrupt(env: CliEnvironment, args: string[], marker: string): Promise<InterruptedRun> {
  const child = spawn(env.command, [...env.args, ...args], { cwd: env.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  onTestFinished(() => {
    child.kill('SIGKILL')
  })
  const { stdout: output, stderr: errors } = child
  expect.assert(output !== null && errors !== null)
  let stdout = '',
    stderr = '',
    interrupted = false
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((settle) => {
    child.on('close', (code, signal) => settle({ code, signal }))
  })
  output.setEncoding('utf8')
  errors.setEncoding('utf8')
  output.on('data', (chunk: string) => {
    stdout += chunk
  })
  errors.on('data', (chunk: string) => {
    stderr += chunk
    if (!interrupted && stderr.includes(marker)) {
      interrupted = true
      child.kill('SIGINT')
    }
  })
  // 割り込みを受け取らずに走り続けた場合でも、終了状態を検証して失敗させるための安全弁。
  const safety = setTimeout(() => child.kill('SIGKILL'), 15_000)
  const { code, signal } = await closed
  clearTimeout(safety)
  return { code, signal, stdout, stderr, interrupted }
}

export interface Fixture {
  readonly dir: string
  readonly file: string
}
/** workspace用のfixture。一時ディレクトリごとテスト終了時に破棄する。 */
export function fixture(source: string): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'hanamaru-cli-'))
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  const file = join(dir, 'sample.test.mjs')
  writeFileSync(file, `import { Test, middleware } from ${JSON.stringify(workspaceRuntime)}\n${source}`)
  return { dir, file }
}

export interface InstalledPackage {
  readonly env: CliEnvironment
  readonly consumer: string
  readonly root: string
}
/** tarballを作ってconsumerにインストールし、インストール済みbinを起動する環境を返す。 */
export function installPackage(): InstalledPackage {
  const root = mkdtempSync(join(tmpdir(), 'hanamaru-package-'))
  const consumer = join(root, 'consumer')
  cpSync(join(repository, 'e2e/fixtures'), consumer, { recursive: true })
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  const packed = execute('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], repository, 60_000)
  expect(packed.status, packed.stderr).toBe(0)
  const [archive] = v.parse(v.tuple([v.object({ filename: v.string() })]), JSON.parse(packed.stdout))
  const installed = execute(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(root, archive.filename)],
    consumer,
    120_000,
  )
  expect(installed.status, installed.stderr).toBe(0)
  const packageDirectory = join(consumer, 'node_modules/hanamaru')
  const manifest = v.parse(
    v.object({ bin: v.object({ hanamaru: v.string() }) }),
    JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8')),
  )
  cpSync(join(packageDirectory, 'docs/examples'), join(consumer, 'examples'), { recursive: true })
  return {
    consumer,
    root,
    env: {
      command: launcher.command,
      args: [...launcher.args, join(packageDirectory, manifest.bin.hanamaru)],
      cwd: consumer,
    },
  }
}
export function removePackage(installed: InstalledPackage) {
  rmSync(installed.root, { recursive: true, force: true })
}
// consumerディレクトリは1ファイル内の全テストで共有する。ここに書いたhanamaru.config.tsやtsconfig.jsonは
// 後続のテストからも見えるため、テストの実行順序に依存する。
export function consumerFixture(installed: InstalledPackage, name: string, source: string): string {
  const file = join(installed.consumer, `${name}.ts`)
  writeFileSync(file, `import { Test, middleware } from 'hanamaru'\n${source}\n`)
  return file
}

export type ParsedRunResult = v.InferOutput<typeof runResultSchema>
/** CLIのJSON出力をスキーマで検証して読む。version以外の形の破れもここで失敗する。 */
export function runResult(stdout: string): ParsedRunResult {
  return v.parse(runResultSchema, JSON.parse(stdout))
}
export function jsonResult(result: SpawnSyncReturns<string>, code: number): ParsedRunResult {
  expect(result.status, result.stderr).toBe(code)
  return runResult(result.stdout)
}

export function asTest(node: MutableNodeResult): MutableTestResult {
  expect.assert(node.kind === 'test')
  return node
}
export function asGroup(node: MutableNodeResult): MutableGroupResult {
  expect.assert(node.kind === 'group')
  return node
}
export function testNode(result: ParsedRunResult, index = 0): MutableTestResult {
  return asTest(result.tests[index])
}
export function groupNode(result: ParsedRunResult, index = 0): MutableGroupResult {
  return asGroup(result.tests[index])
}
export function childTest(group: MutableGroupResult, index = 0): MutableTestResult {
  return asTest(group.children[index].result)
}
export function childGroup(group: MutableGroupResult, index = 0): MutableGroupResult {
  return asGroup(group.children[index].result)
}
export function middlewareOf(group: MutableGroupResult): MutableGroupMiddleware {
  const { middleware } = group
  expect.assert(middleware !== null)
  return middleware
}
export function cases(node: MutableNodeResult): MutableCaseResult[] {
  return node.kind === 'group' ? node.children.flatMap((child) => cases(child.result)) : node.cases
}
