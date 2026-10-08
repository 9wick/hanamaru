import {
  directoryOf,
  findCodeBlocks,
  findLinks,
  findMalformedRows,
  findRelativeImports,
  headings,
  isCodeLanguage,
  isSourceLine,
  countFenceLines,
  parseMarker,
  resolvePath,
  slug,
  sourceLine,
  splitLines,
} from './markdown.ts'
import type { CodeBlock } from './markdown.ts'
import { parseRegions, renderFile, renderRegion } from './regions.ts'
import type { RegionIssueKind } from './regions.ts'

export type SourceFile = { readonly path: string; readonly text: string }
export type Snapshot = {
  readonly documents: readonly SourceFile[]
  readonly examples: readonly SourceFile[]
  readonly markdown: ReadonlyMap<string, string>
  readonly paths: ReadonlySet<string>
}
export type FileWrite = { readonly path: string; readonly text: string }
export type DocsError = { readonly file: string; readonly line: number } & (
  | { readonly kind: 'unbalanced-fences' }
  | { readonly kind: 'broken-link'; readonly link: string }
  | { readonly kind: 'broken-anchor'; readonly link: string }
  | { readonly kind: 'malformed-table'; readonly row: string }
  | { readonly kind: 'missing-marker' }
  | { readonly kind: 'invalid-marker'; readonly reason: string }
  | { readonly kind: 'marker-without-block' }
  | { readonly kind: 'invalid-example-path'; readonly target: string }
  | { readonly kind: 'missing-example'; readonly target: string }
  | { readonly kind: 'unknown-region'; readonly target: string; readonly region: string }
  | { readonly kind: 'out-of-sync'; readonly target: string; readonly part: 'body' | 'source' }
  | { readonly kind: 'unexpected-source-line' }
  | { readonly kind: RegionIssueKind; readonly name: string }
  | { readonly kind: 'orphan-region'; readonly name: string }
  | { readonly kind: 'orphan-file' }
)
export type CheckResult = {
  readonly errors: readonly DocsError[]
  readonly writes: readonly FileWrite[]
  readonly summary: readonly string[]
}

const exampleRoots = ['docs/examples/', 'docs/spec/'] as const
const syncHint = '(npm run docs:sync)'

// `--write` が直せる種類。書き込み後はエラーとして数えない。
export function isFixable(error: DocsError): boolean {
  return error.kind === 'out-of-sync' || error.kind === 'unexpected-source-line'
}

export function formatError(error: DocsError): string {
  return `${error.file}:${error.line}: ${describe(error)}`
}

function describe(error: DocsError): string {
  switch (error.kind) {
    case 'unbalanced-fences':
      return 'unbalanced code fences'
    case 'broken-link':
      return `missing ${error.link}`
    case 'broken-anchor':
      return `missing anchor ${error.link}`
    case 'malformed-table':
      return `malformed table: ${error.row}`
    case 'missing-marker':
      return 'code block needs a marker: <!-- example: docs/examples/x.test.ts#region --> or <!-- example: none — reason -->'
    case 'invalid-marker':
      return `invalid example marker: ${error.reason}`
    case 'marker-without-block':
      return 'example marker is not followed by a ts code block'
    case 'invalid-example-path':
      return `example path must stay inside docs/examples/ or docs/spec/: ${error.target}`
    case 'missing-example':
      return `missing example ${error.target}`
    case 'unknown-region':
      return `missing region #${error.region} in ${error.target}`
    case 'out-of-sync':
      return error.part === 'body'
        ? `code block is out of sync with ${error.target} ${syncHint}`
        : `source line is out of sync with ${error.target} ${syncHint}`
    case 'unexpected-source-line':
      return `none block must not have a source line ${syncHint}`
    case 'unclosed-region':
      return `unclosed region ${error.name}`
    case 'mismatched-endregion':
      return `endregion ${error.name} does not close the open region`
    case 'duplicate-region':
      return `duplicate region ${error.name}`
    case 'invalid-region-name':
      return `invalid region name: ${error.name}`
    case 'empty-region':
      return `empty region ${error.name}`
    case 'orphan-region':
      return `region ${error.name} is not used by any document`
    case 'orphan-file':
      return 'example file is not used by any document and not imported by another example'
  }
}

export function checkCorpus(snapshot: Snapshot): CheckResult {
  const errors: DocsError[] = []
  const writes: FileWrite[] = []
  const references = new Set<string>()
  let links = 0
  let anchors = 0
  let linked = 0
  for (const document of snapshot.documents) {
    const checked = checkDocument(document, snapshot)
    errors.push(...checked.errors)
    if (checked.text !== document.text) writes.push({ path: document.path, text: checked.text })
    for (const reference of checked.references) references.add(reference)
    links += checked.links
    anchors += checked.anchors
    linked += checked.linked
  }
  errors.push(...checkExamples(snapshot, references))
  const summary =
    `${snapshot.documents.length} documents; ${links} local links; ${anchors} anchors; ` +
    `${linked} linked examples; ${countNegativeAssertions(snapshot)} negative type assertions`
  return { errors, writes, summary: [summary] }
}

type DocumentCheck = {
  readonly errors: readonly DocsError[]
  readonly text: string
  readonly references: readonly string[]
  readonly links: number
  readonly anchors: number
  readonly linked: number
}

function checkDocument(document: SourceFile, snapshot: Snapshot): DocumentCheck {
  const errors: DocsError[] = []
  const lines = splitLines(document.text)
  const blocks = findCodeBlocks(lines)
  const fences = countFenceLines(lines)
  if (fences % 2 === 1) errors.push({ kind: 'unbalanced-fences', file: document.path, line: lastFenceLine(lines) })
  const linkCheck = checkLinks(document, snapshot)
  errors.push(...linkCheck.errors)
  for (const row of findMalformedRows(document.text))
    errors.push({ kind: 'malformed-table', file: document.path, line: row.line, row: row.row })
  const examples = checkBlocks(document, snapshot, lines, blocks)
  errors.push(...examples.errors)
  return {
    errors,
    text: examples.lines.join('\n'),
    references: examples.references,
    links: linkCheck.links,
    anchors: linkCheck.anchors,
    linked: examples.linked,
  }
}

function lastFenceLine(lines: readonly string[]): number {
  for (let index = lines.length - 1; index >= 0; index--) if (lines[index].startsWith('```')) return index + 1
  return 1
}

function checkLinks(document: SourceFile, snapshot: Snapshot) {
  const errors: DocsError[] = []
  let links = 0
  let anchors = 0
  for (const reference of findLinks(document.text)) {
    if (reference.link.includes('://')) continue
    links++
    const hash = reference.link.indexOf('#')
    const relative = hash < 0 ? reference.link : reference.link.slice(0, hash)
    const fragment = hash < 0 ? '' : reference.link.slice(hash + 1)
    const destination = relative === '' ? document.path : resolvePath(directoryOf(document.path), relative)
    if (destination === undefined || !snapshot.paths.has(destination)) {
      errors.push({ kind: 'broken-link', file: document.path, line: reference.line, link: reference.link })
      continue
    }
    if (fragment === '' || !destination.endsWith('.md')) continue
    anchors++
    const text = snapshot.markdown.get(destination)
    if (text === undefined) continue
    if (!headings(text).some((heading) => slug(heading) === fragment))
      errors.push({ kind: 'broken-anchor', file: document.path, line: reference.line, link: reference.link })
  }
  return { errors, links, anchors }
}

type BlockCheck = {
  readonly errors: readonly DocsError[]
  readonly lines: readonly string[]
  readonly references: readonly string[]
  readonly linked: number
}

function checkBlocks(
  document: SourceFile,
  snapshot: Snapshot,
  lines: readonly string[],
  blocks: readonly CodeBlock[],
): BlockCheck {
  const errors: DocsError[] = []
  const references: string[] = []
  const output: string[] = []
  const byOpen = new Map(blocks.map((block) => [block.open, block]))
  const fenced = new Set<number>()
  const codeOpens = new Set<number>()
  for (const block of blocks) {
    if (block.close >= 0 && isCodeLanguage(block.info)) codeOpens.add(block.open)
    for (let index = block.open; index <= (block.close < 0 ? lines.length - 1 : block.close); index++) fenced.add(index)
  }
  let linked = 0
  let index = 0
  while (index < lines.length) {
    const block = byOpen.get(index)
    if (block === undefined || block.close < 0 || !isCodeLanguage(block.info)) {
      // フェンス内の例示（```markdown のマーカー説明）は対象外。
      if (!fenced.has(index) && !codeOpens.has(index + 1) && parseMarker(lines[index]) !== undefined)
        errors.push({ kind: 'marker-without-block', file: document.path, line: index + 1 })
      output.push(lines[index])
      index++
      continue
    }
    const marker = index > 0 ? parseMarker(lines[index - 1]) : undefined
    const body = lines.slice(block.open + 1, block.close)
    if (marker === undefined) {
      errors.push({ kind: 'missing-marker', file: document.path, line: index + 1 })
      output.push(...lines.slice(block.open, block.close + 1))
      index = block.close + 1
      continue
    }
    if (marker.kind === 'invalid') {
      errors.push({ kind: 'invalid-marker', file: document.path, line: index, reason: marker.reason })
      output.push(...lines.slice(block.open, block.close + 1))
      index = block.close + 1
      continue
    }
    if (marker.kind === 'none') {
      output.push(...lines.slice(block.open, block.close + 1))
      index = block.close + 1
      if (index < lines.length && isSourceLine(lines[index])) {
        errors.push({ kind: 'unexpected-source-line', file: document.path, line: index + 1 })
        index++
      }
      continue
    }
    linked++
    const rendered = renderExample(snapshot, marker.target, marker.region)
    if (rendered.kind !== 'ok') {
      errors.push(referenceError(rendered, document.path, index, marker.target, marker.region))
      output.push(...lines.slice(block.open, block.close + 1))
      index = block.close + 1
      continue
    }
    references.push(marker.region === undefined ? marker.target : `${marker.target}#${marker.region}`)
    const expected = splitLines(rendered.text)
    if (body.join('\n') !== rendered.text)
      errors.push({
        kind: 'out-of-sync',
        file: document.path,
        line: index + 1,
        target: marker.target,
        part: 'body',
      })
    output.push(lines[block.open], ...expected, lines[block.close])
    index = block.close + 1
    const actual = index < lines.length ? lines[index] : undefined
    if (actual === undefined || !isSourceLine(actual)) continue
    const expectedSource = sourceLine(document.path, marker.target)
    if (actual === expectedSource) {
      output.push(actual)
      index++
      continue
    }
    errors.push({ kind: 'out-of-sync', file: document.path, line: index + 1, target: marker.target, part: 'source' })
    output.push(expectedSource)
    index++
  }
  return { errors, lines: output, references, linked }
}

type RenderedExample =
  | { readonly kind: 'ok'; readonly text: string }
  | { readonly kind: 'invalid-example-path' }
  | { readonly kind: 'missing-example' }
  | { readonly kind: 'unknown-region' }

function renderExample(snapshot: Snapshot, target: string, region: string | undefined): RenderedExample {
  const normalized = resolvePath('', target)
  if (normalized === undefined || normalized !== target || !isExamplePath(target))
    return { kind: 'invalid-example-path' }
  const example = snapshot.examples.find((file) => file.path === target)
  if (example === undefined) return { kind: 'missing-example' }
  const parse = parseRegions(example.text)
  if (region === undefined) return { kind: 'ok', text: renderFile(parse) }
  const found = parse.regions.get(region)
  if (found === undefined) return { kind: 'unknown-region' }
  return { kind: 'ok', text: renderRegion(parse, found) }
}

function referenceError(
  rendered: RenderedExample,
  file: string,
  blockIndex: number,
  target: string,
  region: string | undefined,
): DocsError {
  const line = blockIndex
  if (rendered.kind === 'invalid-example-path') return { kind: 'invalid-example-path', file, line, target }
  if (rendered.kind === 'missing-example') return { kind: 'missing-example', file, line, target }
  return { kind: 'unknown-region', file, line, target, region: region ?? '' }
}

function isExamplePath(path: string): boolean {
  for (const root of exampleRoots) if (path.startsWith(root) && path.length > root.length) return true
  return false
}

function checkExamples(snapshot: Snapshot, references: ReadonlySet<string>): readonly DocsError[] {
  const errors: DocsError[] = []
  const imported = collectImports(snapshot)
  for (const example of snapshot.examples) {
    const parse = parseRegions(example.text)
    for (const issue of parse.issues)
      errors.push({ kind: issue.kind, file: example.path, line: issue.line, name: issue.name })
    let used = references.has(example.path)
    for (const [name, region] of parse.regions) {
      if (references.has(`${example.path}#${name}`)) {
        used = true
        continue
      }
      errors.push({ kind: 'orphan-region', file: example.path, line: region.start + 1, name })
    }
    if (!used && example.path.startsWith('docs/examples/') && !imported.has(example.path))
      errors.push({ kind: 'orphan-file', file: example.path, line: 1 })
  }
  return errors
}

function collectImports(snapshot: Snapshot): ReadonlySet<string> {
  const imported = new Set<string>()
  for (const example of snapshot.examples) {
    const directory = directoryOf(example.path)
    for (const specifier of findRelativeImports(example.text)) {
      const resolved = resolvePath(directory, specifier)
      if (resolved === undefined) continue
      for (const candidate of [resolved, replaceExtension(resolved), `${resolved}.ts`])
        if (snapshot.examples.some((file) => file.path === candidate)) imported.add(candidate)
    }
  }
  return imported
}

function replaceExtension(path: string): string {
  return path.endsWith('.js') ? `${path.slice(0, -3)}.ts` : path
}

function countNegativeAssertions(snapshot: Snapshot): number {
  let count = 0
  for (const example of snapshot.examples) {
    if (!example.path.startsWith('docs/spec/') || !example.path.endsWith('.ts')) continue
    if (example.path.slice('docs/spec/'.length).includes('/')) continue
    count += example.text.split('@ts-expect-error').length - 1
  }
  return count
}
