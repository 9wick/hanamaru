import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

// Workspace exports are source contracts. Published declarations refer only to files in the same tarball.
const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
const manifests = new Map(
  ['blueprint', 'execution', 'module-runtime', 'cli'].map((name) => [
    `@hanamaru/${name}`,
    JSON.parse(readFileSync(resolve(root, 'packages', name, 'package.json'), 'utf8')),
  ]),
)
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
}
const emittedRoot = resolve(dist, 'src')
for (const file of files(emittedRoot)) {
  const destination = resolve(dist, relative(emittedRoot, file))
  mkdirSync(dirname(destination), { recursive: true })
  renameSync(file, destination)
}
rmSync(emittedRoot, { recursive: true })
for (const file of files(dist).filter((path) => path.endsWith('.d.ts'))) {
  let source = readFileSync(file, 'utf8')
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const edits = []
  function visit(node) {
    if (ts.isStringLiteral(node)) {
      const match = node.text.match(/^(@hanamaru\/(?:blueprint|execution|module-runtime|cli))(?:\/(.*))?$/)
      if (match) {
        const [, name, subpath] = match
        const target = manifests.get(name).exports[subpath === undefined ? '.' : `./${subpath}`]
        if (typeof target !== 'string')
          throw new Error(`declaration references an unpublished workspace export: ${node.text}`)
        const namePart = name.slice('@hanamaru/'.length)
        const declaration = resolve(dist, 'packages', namePart, target.replace(/\.ts$/, '.d.ts'))
        if (!existsSync(declaration)) throw new Error(`missing packaged declaration: ${declaration}`)
        const path = relative(dirname(file), declaration)
          .split(sep)
          .join('/')
          .replace(/\.d\.ts$/, '.js')
        edits.push([node.getStart(tree), node.end, JSON.stringify(path.startsWith('.') ? path : `./${path}`)])
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0]))
    source = source.slice(0, start) + replacement + source.slice(end)
  writeFileSync(file, source)
}
