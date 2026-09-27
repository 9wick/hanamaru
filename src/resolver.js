import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const cache = new Map()
function jsonc(text) {
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
  return JSON.parse(clean.replace(/,\s*([}\]])/g, '$1'))
}
function configFor(parentURL) {
  if (!parentURL?.startsWith('file:')) return null
  let directory = dirname(fileURLToPath(parentURL))
  const visited = []
  while (true) {
    if (cache.has(directory)) {
      const value = cache.get(directory)
      for (const path of visited) cache.set(path, value)
      return value
    }
    visited.push(directory)
    const path = join(directory, 'tsconfig.json')
    if (existsSync(path)) {
      const value = { directory, config: jsonc(readFileSync(path, 'utf8')) }
      for (const part of visited) cache.set(part, value)
      return value
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  for (const part of visited) cache.set(part, null)
  return null
}
function aliasCandidates(specifier, parentURL) {
  const entry = configFor(parentURL)
  if (!entry) return []
  const options = entry.config.compilerOptions ?? {}
  const base = resolvePath(entry.directory, options.baseUrl ?? '.')
  const matches = []
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
function extensions(file) {
  if (extname(file) === '.js') return [file.slice(0, -3) + '.ts', file.slice(0, -3) + '.mts']
  if (!extname(file)) return [file + '.ts', file + '.mts', file + '.js', file + '/index.ts', file + '/index.js']
  return [file]
}
function candidatesFor(specifier, parentURL) {
  return specifier.startsWith('.') && parentURL?.startsWith('file:')
    ? [fileURLToPath(new URL(specifier, parentURL))]
    : isAbsolute(specifier)
      ? [specifier]
      : aliasCandidates(specifier, parentURL)
}
export function resolveSync(specifier, context, nextResolve) {
  const resolved = nextResolve(specifier, context)
  if (!resolved.url.startsWith('file:') || existsSync(fileURLToPath(resolved.url))) return resolved
  for (const candidate of candidatesFor(specifier, context.parentURL)) {
    for (const file of [candidate, ...extensions(candidate)]) {
      if (existsSync(file)) return nextResolve(pathToFileURL(file).href, context)
    }
  }
  return resolved
}
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (!['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'].includes(error.code)) throw error
    const candidates = candidatesFor(specifier, context.parentURL)
    for (const candidate of candidates)
      for (const file of extensions(candidate)) {
        if (existsSync(file)) return nextResolve(pathToFileURL(file).href, context)
      }
    throw error
  }
}
