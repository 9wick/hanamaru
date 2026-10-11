import type { ProjectFiles } from '../ports/collection-host.js'
import type { CollectionRequest } from '../ports/collection-runner.js'
import type { Config } from './config.js'
export interface SelectedFile {
  file: string
  projects: string[]
}

export function selectFiles(
  config: Config,
  request: CollectionRequest,
  { resolve, glob }: ProjectFiles,
): SelectedFile[] {
  if (request.files.length)
    return [...new Set(request.files.map((file) => resolve(file)))].sort().map((file) => ({ file, projects: [] }))
  if (config.projects) {
    const selected = new Map<string, SelectedFile>()
    const names = [...new Set(request.options.projects ?? Object.keys(config.projects))]
    for (const name of names) {
      if (!Object.hasOwn(config.projects, name)) throw new TypeError(`unknown project: ${name}`)
      const { include, exclude = [] } = config.projects[name]
      const excluded = new Set(exclude.flatMap((pattern) => [...glob(pattern)].map((file) => resolve(file))))
      for (const pattern of include) {
        for (const match of glob(pattern)) {
          const file = resolve(match)
          if (excluded.has(file)) continue
          const entry = selected.get(file) ?? { file, projects: [] }
          if (!entry.projects.includes(name)) entry.projects.push(name)
          selected.set(file, entry)
        }
      }
    }
    return [...selected.values()].sort((a, b) => a.file.localeCompare(b.file))
  }
  if (request.options.projects?.length) throw new TypeError(`unknown project: ${request.options.projects[0]}`)
  const include = ['**/*.{test,spec}.ts']
  const exclude = ['**/node_modules/**', '**/dist/**']
  const files = new Set(include.flatMap((pattern) => [...glob(pattern)]))
  for (const pattern of exclude) for (const file of glob(pattern)) files.delete(file)
  return [...files]
    .map((file) => resolve(file))
    .sort()
    .map((file) => ({ file, projects: [] }))
}
