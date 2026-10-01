import type { Lifecycle } from '@zeltjs/core'
import { Injectable, LifecycleManager, inject } from '@zeltjs/core'
import type { InlineConfig, UserConfig, ViteDevServer } from '@hanamaru/vite'
import { createServer, mergeConfig } from '@hanamaru/vite'
import type { FetchResult } from '@hanamaru/vite/module-runner'
import { parse } from 'acorn'
import { existsSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as v from 'valibot'
import type { Value } from '../../foundation/value.js'
import { required } from '../../foundation/value.js'
import { ModuleEntry } from './entry.js'
import { TsconfigResolver } from './resolver.js'

// Vite 8.3 guards generated export getters. Preserve TDZ errors without changing user catch blocks.
export function preserveExportErrors(code: string) {
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module' })
  const edits: [number, number][] = []
  for (const statement of ast.body) {
    const call = statement.type === 'ExpressionStatement' && statement.expression
    if (
      !call ||
      call.type !== 'CallExpression' ||
      call.callee.type !== 'Identifier' ||
      call.callee.name !== '__vite_ssr_exportName__'
    )
      continue
    const getter = call.arguments[1]
    if (getter?.type !== 'ArrowFunctionExpression' || getter.body.type !== 'BlockStatement') continue
    const guarded = getter.body.body
    if (guarded.length !== 1) continue
    const guard = guarded[0]
    if (guard.type !== 'TryStatement' || guard.finalizer || guard.handler?.body.body.length !== 0) continue
    edits.push([guard.start, guard.block.start + 1], [guard.block.end - 1, guard.end])
  }
  for (const [start, end] of edits.sort((a, b) => b[0] - a[0]))
    code = code.slice(0, start) + code.slice(start, end).replace(/[^\r\n]/g, ' ') + code.slice(end)
  return code
}

/**
 * 変換したコードを配るVite server。読んだpackage種別と取り寄せた結果を覚えるため、1つのscopeに1つだけ立てる。
 * vite設定は設定ファイルを読むまで決まらないため、開くのはstart。解放だけをscopeの終了に預ける。
 */
@Injectable()
export class ModuleCompiler implements Lifecycle {
  readonly #tsconfig: TsconfigResolver
  readonly #implementationRoot: string
  readonly #runtimeURL: string
  readonly #packageTypes = new Map<string, string | undefined>()
  readonly #records = new Map<string, Promise<FetchResult>>()
  #server: ViteDevServer | undefined
  #closing: Promise<void> | undefined

  constructor(tsconfig = inject(TsconfigResolver), entry = inject(ModuleEntry), lifecycle = inject(LifecycleManager)) {
    this.#tsconfig = tsconfig
    this.#implementationRoot = dirname(fileURLToPath(entry.url))
    this.#runtimeURL = entry.url.href
    lifecycle.register(this)
  }

  /** 開く合図はstartが受け持つ。scopeの起動時にはまだvite設定が決まっていない。 */
  startup(): void {}

  shutdown(): Promise<void> {
    return this.close()
  }

  async start(vite: UserConfig = {}): Promise<void> {
    if (!vite || typeof vite !== 'object' || Array.isArray(vite)) throw new TypeError('vite must be a config object')
    this.#server = await createServer(this.#serverConfig(vite))
  }

  #packageType(directory: string): string | undefined {
    if (this.#packageTypes.has(directory)) return this.#packageTypes.get(directory)
    const manifest = resolve(directory, 'package.json')
    const parent = dirname(directory)
    const type = existsSync(manifest)
      ? v.parse(v.object({ type: v.optional(v.string(), 'commonjs') }), JSON.parse(readFileSync(manifest, 'utf8'))).type
      : parent === directory || directory.endsWith('/node_modules')
        ? undefined
        : this.#packageType(parent)
    this.#packageTypes.set(directory, type)
    return type
  }

  /** frameworkそのものとcommonjsは変換の外に置く。変換するとruntimeの同一性とrequireが壊れる。 */
  #external(id: string): Extract<FetchResult, { externalize: string }> | undefined {
    const path = id.startsWith('file:') ? fileURLToPath(id) : id
    const commonjs = path.endsWith('.cjs') || (path.endsWith('.js') && this.#packageType(dirname(path)) === 'commonjs')
    if (path.startsWith(`${this.#implementationRoot}/`) || commonjs)
      return { externalize: pathToFileURL(path).href, type: commonjs ? 'commonjs' : 'module' }
  }

  #serverConfig(vite: UserConfig): InlineConfig {
    const options = mergeConfig(
      {
        root: process.cwd(),
        logLevel: 'silent',
        resolve: { tsconfigPaths: true },
        ssr: { noExternal: true },
      },
      vite,
    )
    const tsconfig = this.#tsconfig
    return {
      ...options,
      configFile: false,
      appType: 'custom',
      clearScreen: false,
      server: { ...vite.server, middlewareMode: true, watch: null, ws: false },
      plugins: [
        {
          name: 'hanamaru-runtime',
          enforce: 'pre',
          resolveId: (source, importer) => {
            if (source === 'hanamaru') return { id: this.#runtimeURL, external: true }
            const id = source.startsWith('file:')
              ? fileURLToPath(source)
              : source.startsWith('.') && importer
                ? resolve(dirname(importer), source)
                : source
            const found = this.#external(id)
            if (found) return { id: found.externalize, external: true }
          },
        },
        ...(vite.plugins ?? []),
        {
          name: 'hanamaru-js-paths',
          enforce: 'post',
          resolveId(source, importer) {
            // Preserve the CLI's tsconfig paths support for JS test files, including files outside root.
            if (!importer || !/\.[cm]?js$/.test(importer) || source.startsWith('.') || source.startsWith('/')) return
            return tsconfig.resolve(source, pathToFileURL(importer).href)
          },
        },
      ],
    }
  }

  async invoke(name: string, args: Value[]): Promise<Value> {
    if (this.#closing) throw new Error('module compiler is closed')
    if (name === 'getBuiltins') return [...builtinModules, { type: 'regexp', source: '^node:', flags: '' }]
    if (name !== 'fetchModule') throw new Error(`unknown module request: ${name}`)
    const [url, importer, fetchOptions] = v.parse(
      v.tuple([
        v.string(),
        v.optional(v.string()),
        v.object({ cached: v.optional(v.boolean()), startOffset: v.optional(v.number()) }),
      ]),
      args,
    )
    if (url.startsWith('file:')) {
      const found = this.#external(url)
      if (found) return found
    }
    const key = JSON.stringify([url, importer, fetchOptions.startOffset])
    if (!this.#records.has(key)) this.#records.set(key, this.#fetch(url, importer, fetchOptions.startOffset))
    return { ...(await required(this.#records.get(key))) }
  }

  async #fetch(url: string, importer: string | undefined, startOffset: number | undefined): Promise<FetchResult> {
    const server = required(this.#server, 'module compiler was not started')
    const result = await required(server.environments.ssr).fetchModule(url, importer, { startOffset, cached: false })
    if ('file' in result && result.file) {
      const found = this.#external(result.file)
      if (found) return found
    }
    return {
      ...result,
      ...('code' in result ? { code: preserveExportErrors(result.code) } : {}),
      invalidate: false,
    }
  }

  /** 二重に閉じても同じ約束を返す。開く前に畳まれたscopeでは閉じる相手がない。閉じたあとの取り寄せは受け付けない。 */
  close(): Promise<void> {
    const server = this.#server
    this.#closing ??= server ? server.close() : Promise.resolve()
    return this.#closing
  }
}
