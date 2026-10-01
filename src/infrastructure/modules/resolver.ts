import { Injectable } from '@zeltjs/core'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as v from 'valibot'

interface Tsconfig {
  compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> }
}

interface ConfigEntry {
  directory: string
  config: Tsconfig
}

function jsonc(text: string): Tsconfig {
  let clean = '',
    quote = false,
    escaped = false,
    line = false,
    block = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i],
      next = text[i + 1]
    if (line) {
      if (char === '\n') {
        line = false
        clean += char
      }
      continue
    }
    if (block) {
      if (char === '*' && next === '/') {
        block = false
        i++
      }
      continue
    }
    if (quote) {
      clean += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quote = false
      continue
    }
    if (char === '"') {
      quote = true
      clean += char
      continue
    }
    if (char === '/' && next === '/') {
      line = true
      i++
      continue
    }
    if (char === '/' && next === '*') {
      block = true
      i++
      continue
    }
    clean += char
  }
  return v.parse(
    v.object({
      compilerOptions: v.optional(
        v.object({ baseUrl: v.optional(v.string()), paths: v.optional(v.record(v.string(), v.array(v.string()))) }),
      ),
    }),
    JSON.parse(clean.replace(/,\s*([}\]])/g, '$1')),
  )
}

function aliasCandidates(entry: ConfigEntry, specifier: string): string[] {
  const options = entry.config.compilerOptions ?? {}
  const base = resolvePath(entry.directory, options.baseUrl ?? '.')
  const matches: string[] = []
  for (const [pattern, replacements] of Object.entries(options.paths ?? {})) {
    const star = pattern.indexOf('*')
    const prefix = star < 0 ? pattern : pattern.slice(0, star)
    const suffix = star < 0 ? '' : pattern.slice(star + 1)
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue
    if (star < 0 && specifier !== pattern) continue
    const captured = specifier.slice(prefix.length, specifier.length - suffix.length)
    for (const replacement of replacements) matches.push(resolvePath(base, replacement.replace('*', captured)))
  }
  return matches
}

function extensions(file: string) {
  if (extname(file) === '.js') return [file.slice(0, -3) + '.ts', file.slice(0, -3) + '.mts']
  if (!extname(file)) return [file + '.ts', file + '.mts', file + '.js', file + '/index.ts', file + '/index.js']
  return [file]
}

/**
 * tsconfigのpathsでJSの指定子を解決する。読み込んだtsconfigは覚えたまま再利用するため、
 * 探索の結果が1つのcompilerの寿命の中で揺れない。
 */
@Injectable()
export class TsconfigResolver {
  readonly #configs = new Map<string, ConfigEntry | null>()

  /** 探索の途中で通ったディレクトリにも答えを書き戻し、兄弟ファイルからの解決を1回で済ませる。 */
  #configFor(parentURL: string): ConfigEntry | null {
    if (!parentURL?.startsWith('file:')) return null
    let directory = dirname(fileURLToPath(parentURL))
    const visited: string[] = []
    while (true) {
      if (this.#configs.has(directory)) {
        const value = this.#configs.get(directory)
        if (value === undefined) throw new Error('tsconfig cache entry is missing')
        for (const path of visited) this.#configs.set(path, value)
        return value
      }
      visited.push(directory)
      const path = join(directory, 'tsconfig.json')
      if (existsSync(path)) {
        const value = { directory, config: jsonc(readFileSync(path, 'utf8')) }
        for (const part of visited) this.#configs.set(part, value)
        return value
      }
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
    for (const part of visited) this.#configs.set(part, null)
    return null
  }

  resolve(specifier: string, parentURL: string): string | null {
    const entry = this.#configFor(parentURL)
    if (!entry) return null
    for (const candidate of aliasCandidates(entry, specifier))
      for (const file of extensions(candidate)) if (existsSync(file)) return file
    return null
  }
}
