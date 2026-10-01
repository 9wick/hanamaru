// CLIの親プロセスは収集をworkerへ任せるだけで、DIコンテナを組み立てない。
// DIの道具を親の起動経路へ連れ込むと、1回の起動ごとにその読み込み時間を払うことになるため、配布物の形で止める。
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { expect, test } from 'vite-plus/test'
import { repository } from './harness.ts'

const forbidden = [/^@zeltjs\//, /^hono(\/|$)/, /^@standard-schema\//]

/** 配布物の静的import。externalの宛先と、同梱された自前chunkの両方を拾う。 */
function specifiersOf(source: string): string[] {
  const statements = source.matchAll(/(?:^|[^\w$])(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g)
  const dynamic = source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)
  return [...statements, ...dynamic].map((match) => match[1] ?? '')
}

/** 入口から静的に辿り着く配布ファイルと、そこが外部へ出す宛先。 */
function staticGraph(entry: string): { files: Map<string, string>; externals: Set<string> } {
  const files = new Map<string, string>()
  const externals = new Set<string>()
  const visit = (file: string): void => {
    if (files.has(file)) return
    const source = readFileSync(file, 'utf8')
    files.set(file, source)
    for (const specifier of specifiersOf(source)) {
      if (specifier.startsWith('.')) visit(resolve(dirname(file), specifier))
      else externals.add(specifier)
    }
  }
  visit(entry)
  return { files, externals }
}

test('CLI parent process does not load the dependency injection toolkit', () => {
  const { files, externals } = staticGraph(join(repository, 'dist/cli.js'))
  expect([...externals].filter((specifier) => forbidden.some((pattern) => pattern.test(specifier)))).toEqual([])
  // 同梱された場合はimportの宛先に出ないため、展開後のコードに残る名前で見る。
  expect([...files].filter(([, source]) => /\bZelt[A-Z]/.test(source)).map(([file]) => file)).toEqual([])
})
