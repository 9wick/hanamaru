import { readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { sep } from 'node:path'
import { checkCorpus, formatError, isFixable } from './docs/check.ts'
import type { DocsError, Snapshot, SourceFile } from './docs/check.ts'

export type RunResult = { readonly code: number; readonly lines: readonly string[] }

const skippedDirectories = ['node_modules', '.git', 'dist', 'coverage']
const exampleDirectories = ['docs/examples', 'docs/spec']

export async function run(argv: readonly string[], context: { readonly cwd: string }): Promise<RunResult> {
  let write = false
  for (const word of argv) {
    if (word === '--write') write = true
    else return { code: 2, lines: [`unknown option: ${word}`] }
  }
  const root = await realpath(context.cwd)
  const snapshot = await buildSnapshot(root)
  const result = checkCorpus(snapshot)
  const lines = [...result.summary]
  if (write) {
    for (const file of result.writes) {
      await writeFile(`${root}/${file.path}`, file.text)
      lines.push(`updated ${file.path}`)
    }
  }
  const remaining: DocsError[] = []
  for (const error of result.errors) if (!write || !isFixable(error)) remaining.push(error)
  for (const error of remaining) lines.push(formatError(error))
  lines.push(`errors: ${remaining.length}`)
  return { code: remaining.length > 0 ? 1 : 0, lines }
}

async function buildSnapshot(root: string): Promise<Snapshot> {
  // リポジトリ直下を指すリンク（`..`）の宛先。
  const paths = new Set<string>(['.'])
  const markdown = new Map<string, string>()
  await walk(root, '', paths, markdown)
  const documents: SourceFile[] = []
  for (const path of ['README.md', ...[...markdown.keys()].filter(isDocument).sort()]) {
    const text = markdown.get(path)
    if (text !== undefined) documents.push({ path, text })
  }
  const examples: SourceFile[] = []
  for (const path of [...paths].sort())
    if (isExampleFile(path) && (await isRegularInside(root, path)))
      examples.push({ path, text: await readFile(`${root}/${path}`, 'utf8') })
  return { documents, examples, markdown, paths }
}

function isDocument(path: string): boolean {
  return path.startsWith('docs/') && path.endsWith('.md') && !path.slice('docs/'.length).includes('/')
}

function isExampleFile(path: string): boolean {
  for (const directory of exampleDirectories) if (path.startsWith(`${directory}/`)) return true
  return false
}

// シンボリックリンクは辿らない。実体パスが位置と一致するファイルだけを例として扱い、外部への脱出を防ぐ。
async function isRegularInside(root: string, path: string): Promise<boolean> {
  try {
    const resolved = await realpath(`${root}/${path}`)
    return resolved === `${root}${sep}${path.replaceAll('/', sep)}`
  } catch {
    return false
  }
}

async function walk(root: string, directory: string, paths: Set<string>, markdown: Map<string, string>): Promise<void> {
  const entries = await readdir(directory === '' ? root : `${root}/${directory}`, { withFileTypes: true })
  for (const entry of entries) {
    const path = directory === '' ? entry.name : `${directory}/${entry.name}`
    if (entry.isDirectory()) {
      paths.add(path)
      if (!skippedDirectories.includes(entry.name)) await walk(root, path, paths, markdown)
      continue
    }
    paths.add(path)
    if (entry.isFile() && path.endsWith('.md')) markdown.set(path, await readFile(`${root}/${path}`, 'utf8'))
  }
}

// 直接実行されたときだけ CLI として動く（テストからは run() を呼ぶ）。
async function isEntryPoint(): Promise<boolean> {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    return (await realpath(entry)) === import.meta.filename
  } catch {
    return false
  }
}

if (await isEntryPoint()) {
  const result = await run(process.argv.slice(2), { cwd: process.cwd() })
  for (const line of result.lines) process.stdout.write(`${line}\n`)
  process.exitCode = result.code
}
