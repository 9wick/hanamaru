import type { UserConfig } from '@hanamaru/vite'
import { createServer, mergeConfig } from '@hanamaru/vite'
import type { FetchResult } from '@hanamaru/vite/module-runner'
import { parse } from 'acorn'
import { existsSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as v from 'valibot'
import type { ModuleInvoke } from '../../application/ports/module-loader.js'
import { required } from '../../foundation/value.js'
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

export async function createModuleCompiler(entryURL: URL, vite: UserConfig = {}) {
  if (!vite || typeof vite !== 'object' || Array.isArray(vite)) throw new TypeError('vite must be a config object')
  const tsconfig = new TsconfigResolver()
  const implementationRoot = dirname(fileURLToPath(entryURL))
  const runtimeURL = entryURL.href
  const isFramework = (id: string) => id.startsWith(`${implementationRoot}/`)
  const packageTypes = new Map<string, string | undefined>()
  function packageType(directory: string): string | undefined {
    if (packageTypes.has(directory)) return packageTypes.get(directory)
    const manifest = resolve(directory, 'package.json')
    const parent = dirname(directory)
    const type = existsSync(manifest)
      ? v.parse(v.object({ type: v.optional(v.string(), 'commonjs') }), JSON.parse(readFileSync(manifest, 'utf8'))).type
      : parent === directory || directory.endsWith('/node_modules')
        ? undefined
        : packageType(parent)
    packageTypes.set(directory, type)
    return type
  }
  const external = (id: string): Extract<FetchResult, { externalize: string }> | undefined => {
    const path = id.startsWith('file:') ? fileURLToPath(id) : id
    const commonjs = path.endsWith('.cjs') || (path.endsWith('.js') && packageType(dirname(path)) === 'commonjs')
    if (isFramework(path) || commonjs)
      return { externalize: pathToFileURL(path).href, type: commonjs ? 'commonjs' : 'module' }
  }
  const options = mergeConfig(
    {
      root: process.cwd(),
      logLevel: 'silent',
      resolve: { tsconfigPaths: true },
      ssr: { noExternal: true },
    },
    vite,
  )
  const server = await createServer({
    ...options,
    configFile: false,
    appType: 'custom',
    clearScreen: false,
    server: { ...vite.server, middlewareMode: true, watch: null, ws: false },
    plugins: [
      {
        name: 'hanamaru-runtime',
        enforce: 'pre',
        resolveId(source, importer) {
          if (source === 'hanamaru') return { id: runtimeURL, external: true }
          const id = source.startsWith('file:')
            ? fileURLToPath(source)
            : source.startsWith('.') && importer
              ? resolve(dirname(importer), source)
              : source
          const found = external(id)
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
  })
  const records = new Map<string, Promise<FetchResult>>()
  const invoke: ModuleInvoke = async (name, args) => {
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
      const found = external(url)
      if (found) return found
    }
    const key = JSON.stringify([url, importer, fetchOptions.startOffset])
    if (!records.has(key))
      records.set(
        key,
        (async () => {
          const result = await required(server.environments.ssr).fetchModule(url, importer, {
            ...fetchOptions,
            cached: false,
          })
          if ('file' in result && result.file) {
            const found = external(result.file)
            if (found) return found
          }
          return {
            ...result,
            ...('code' in result ? { code: preserveExportErrors(result.code) } : {}),
            invalidate: false,
          }
        })(),
      )
    return { ...(await required(records.get(key))) }
  }
  return { invoke, close: () => server.close() }
}
