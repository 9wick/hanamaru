import { existsSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import swc from 'unplugin-swc'
import * as v from 'valibot'
import { defineConfig } from 'vite-plus'

const nodeModules = `${sep}node_modules${sep}`
const noticeNames = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'NOTICE']
const manifestSchema = v.object({ name: v.string(), version: v.string(), license: v.optional(v.string(), 'UNKNOWN') })

/** 同梱したファイルの置き場所から、取り込み元のパッケージの根を引く。 */
function packageRootOf(id: string): string | null {
  const at = id.lastIndexOf(nodeModules)
  if (at < 0) return null
  const head = id.slice(0, at + nodeModules.length)
  const segments = id.slice(at + nodeModules.length).split(sep)
  const depth = segments[0]?.startsWith('@') ? 2 : 1
  return segments.length > depth ? head + segments.slice(0, depth).join(sep) : null
}

/** 1パッケージ分の表示。許諾本文を配らないパッケージもあるため、宣言だけの行も残す。 */
function noticeOf(root: string): string {
  const manifest = v.parse(manifestSchema, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')))
  const notice = noticeNames.map((name) => join(root, name)).find((file) => existsSync(file))
  const body = notice ? `\n\n\`\`\`\n${readFileSync(notice, 'utf8').trim()}\n\`\`\`` : ''
  return `## ${manifest.name} ${manifest.version}\n\nSPDX-License-Identifier: ${manifest.license}${body}\n`
}

// 標準デコレータはOxcの変換を素通りして配布JSに残るため、DIのdecoratorを使うsrcだけSWCに通す。
const decoratorTransform = {
  include: /\/src\/.*\.ts$/,
  jsc: {
    target: 'es2022',
    // デコレータの展開helperはファイルごとに数百行ある。取り込みにして配布物へ1つだけ入れる。
    externalHelpers: true,
    parser: { syntax: 'typescript', decorators: true },
    transform: { decoratorVersion: '2022-03' },
  },
} as const

export default defineConfig({
  lint: {
    ignorePatterns: ['docs/spec/**', 'dist/**'],
  },
  fmt: {
    singleQuote: true,
    semi: false,
    printWidth: 120,
    ignorePatterns: ['docs/**', 'dist/**'],
  },
  test: {
    projects: [
      {
        plugins: [swc.vite({ ...decoratorTransform, include: /\.ts$/ })],
        oxc: false,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'eslint.config.test.ts'],
        },
      },
      {
        test: {
          name: 'e2e-workspace',
          include: ['e2e/workspace-cli.test.ts', 'e2e/project-registration.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
      {
        test: {
          name: 'e2e-package',
          include: ['e2e/installed-package.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
  pack: {
    plugins: [
      swc.rolldown(decoratorTransform),
      // 同梱したパッケージの許諾は配布物に残す必要がある。bundlerはLICENSEファイルまでは運ばないため、ここで集める。
      {
        name: 'third-party-notices',
        generateBundle(_options, bundle) {
          const roots = new Set<string>()
          for (const chunk of Object.values(bundle))
            if (chunk.type === 'chunk')
              for (const id of chunk.moduleIds) {
                const root = packageRootOf(id)
                if (root) roots.add(root)
              }
          const notices = [...roots].map(noticeOf).sort()
          this.emitFile({
            type: 'asset',
            fileName: 'THIRD-PARTY-NOTICES.md',
            source: `# Third-party notices\n\nhanamaruの配布物には次のパッケージが同梱されている。\n\n${notices.join('\n')}`,
          })
        },
      },
    ],
    // 配布物の依存はpublishの時点で同梱する。利用者側のnode_modules解決を1回の起動から取り除く。
    deps: {
      alwaysBundle: [
        'valibot',
        '@vitest/expect',
        '@standard-schema/spec',
        '@zeltjs/core',
        '@zeltjs/decorator-metadata',
        'hono',
        /^@swc\/helpers\//,
      ],
      // viteは利用者の設定と同じ実体でなければならない。acornはtest runtimeが読む構文解析器と揃える。
      neverBundle: ['@hanamaru/vite', '@hanamaru/vite/module-runner', 'acorn'],
      onlyBundle: false,
    },
    entry: ['src/index.ts', 'src/cli.ts', 'src/cli-worker.ts', 'src/execution-worker.ts'],
    dts: false,
    fixedExtension: false,
    format: 'esm',
    platform: 'node',
    outDir: 'dist',
  },
})
