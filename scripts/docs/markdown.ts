export type CodeBlock = {
  readonly info: string
  readonly open: number
  readonly close: number
}
export type LinkReference = { readonly link: string; readonly line: number }
export type TableRow = { readonly row: string; readonly line: number }
export type Marker =
  | { readonly kind: 'example'; readonly target: string; readonly region: string | undefined }
  | { readonly kind: 'none'; readonly reason: string }
  | { readonly kind: 'invalid'; readonly reason: string }

const markerPrefix = '<!-- example:'
const markerSuffix = '-->'
const sourcePrefix = '出典: '
const codeLanguages = ['ts', 'typescript', 'tsx'] as const

export function splitLines(text: string): readonly string[] {
  return text.split('\n')
}

export function normalizeNewlines(text: string): string {
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
}

export function lineOfIndex(text: string, index: number): number {
  return text.slice(0, index).split('\n').length
}

// 日本語見出しへのアンカーを壊さないよう、除去するのは ASCII の記号だけにする。
export function slug(heading: string): string {
  let slugged = ''
  for (const character of heading.toLowerCase()) {
    const code = character.codePointAt(0) ?? 0
    if (code >= 0x80 || /[\w\- ]/.test(character)) slugged += character
  }
  return slugged.replaceAll(' ', '-')
}

// フェンスの内外を区別しないのは、見出しの取りこぼしでアンカー切れを誤報するより緩い判定を選んだため。
export function headings(text: string): readonly string[] {
  const found: string[] = []
  for (const line of splitLines(text)) {
    let hashes = 0
    while (hashes < line.length && line[hashes] === '#') hashes++
    if (hashes === 0 || line[hashes] !== ' ') continue
    const heading = line.slice(hashes + 1)
    if (heading.length > 0) found.push(heading)
  }
  return found
}

export function countFenceLines(lines: readonly string[]): number {
  let count = 0
  for (const line of lines) if (line.startsWith('```')) count++
  return count
}

export function findCodeBlocks(lines: readonly string[]): readonly CodeBlock[] {
  const blocks: CodeBlock[] = []
  let open = -1
  let info = ''
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (!line.startsWith('```')) continue
    if (open < 0) {
      open = index
      info = line.slice(3).trim()
    } else {
      blocks.push({ info, open, close: index })
      open = -1
      info = ''
    }
  }
  if (open >= 0) blocks.push({ info, open, close: -1 })
  return blocks
}

export function isCodeLanguage(info: string): boolean {
  const space = info.search(/\s/)
  const language = space < 0 ? info : info.slice(0, space)
  for (const candidate of codeLanguages) if (candidate === language) return true
  return false
}

export function findLinks(text: string): readonly LinkReference[] {
  const references: LinkReference[] = []
  let index = text.indexOf('](')
  while (index >= 0) {
    const end = text.indexOf(')', index + 2)
    if (end < 0) break
    if (end > index + 2) {
      references.push({ link: text.slice(index + 2, end), line: lineOfIndex(text, index) })
      index = text.indexOf('](', end + 1)
    } else index = text.indexOf('](', index + 1)
  }
  return references
}

// 表の検査結果を元の行番号で報告するため、コード部分は改行だけ残して消す。
export function stripCodeSpans(text: string): string {
  let stripped = ''
  let index = 0
  for (;;) {
    const start = text.indexOf('```', index)
    if (start < 0) break
    const end = text.indexOf('```', start + 3)
    if (end < 0) break
    stripped += text.slice(index, start)
    stripped += '\n'.repeat(text.slice(start, end + 3).split('\n').length - 1)
    index = end + 3
  }
  return stripped + text.slice(index)
}

export function findMalformedRows(text: string): readonly TableRow[] {
  const malformed: TableRow[] = []
  let width: number | undefined
  const lines = splitLines(stripCodeSpans(text))
  for (let index = 0; index < lines.length; index++) {
    const row = lines[index]
    if (!row.startsWith('|')) {
      width = undefined
      continue
    }
    const columns = row.split(/(?<!\\)\|/).length
    if (width === undefined) width = columns
    else if (columns !== width) malformed.push({ row, line: index + 1 })
  }
  return malformed
}

export function parseMarker(line: string): Marker | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith(markerPrefix) || !trimmed.endsWith(markerSuffix)) return undefined
  const body = trimmed.slice(markerPrefix.length, trimmed.length - markerSuffix.length).trim()
  if (body === '') return { kind: 'invalid', reason: 'marker has no example reference' }
  if (isNoneMarker(body)) return parseNoneMarker(body)
  const hash = body.indexOf('#')
  const target = hash < 0 ? body : body.slice(0, hash)
  const region = hash < 0 ? undefined : body.slice(hash + 1)
  if (target === '') return { kind: 'invalid', reason: 'marker has no example path' }
  if (region !== undefined && region === '') return { kind: 'invalid', reason: 'marker has an empty region name' }
  return { kind: 'example', target, region }
}

function isNoneMarker(body: string): boolean {
  if (body === 'none') return true
  if (!body.startsWith('none')) return false
  const separator = body[4]
  return separator === ' ' || separator === '\t' || separator === '—' || separator === '-'
}

function parseNoneMarker(body: string): Marker {
  const rest = body.slice(4).trimStart()
  // 区切りは全角ダッシュでもハイフンでもよいが、理由は必須。
  if (!rest.startsWith('—') && !rest.startsWith('-')) return { kind: 'invalid', reason: 'none marker needs a reason' }
  const reason = rest.slice(1).trim()
  if (reason === '') return { kind: 'invalid', reason: 'none marker needs a reason' }
  return { kind: 'none', reason }
}

export function isSourceLine(line: string): boolean {
  return line.startsWith(sourcePrefix)
}

export function sourceLine(document: string, target: string): string {
  return `${sourcePrefix}[${target}](${relativeFrom(directoryOf(document), target)})`
}

export function directoryOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

// 解決できない（リポジトリ外へ出る）参照は undefined を返し、呼び出し側でエラーにする。
export function resolvePath(baseDirectory: string, relative: string): string | undefined {
  if (relative.startsWith('/')) return undefined
  const segments = baseDirectory === '' ? [] : baseDirectory.split('/')
  for (const segment of relative.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) return undefined
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  // リポジトリ直下そのものを指す参照（`..` など）は '.' として扱う。
  if (segments.length === 0) return '.'
  return segments.join('/')
}

export function relativeFrom(baseDirectory: string, target: string): string {
  const from = baseDirectory === '' ? [] : baseDirectory.split('/')
  const to = target.split('/')
  let shared = 0
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) shared++
  const up = from.slice(shared).map(() => '..')
  return [...up, ...to.slice(shared)].join('/')
}

// 相対 import 指定子だけを集める。孤立ファイル判定で「他の例から使われている」ことを示すのに使う。
export function findRelativeImports(text: string): readonly string[] {
  const specifiers: string[] = []
  for (const line of splitLines(text)) {
    for (const quote of ["'", '"']) {
      let index = line.indexOf(quote)
      while (index >= 0) {
        const end = line.indexOf(quote, index + 1)
        if (end < 0) break
        const specifier = line.slice(index + 1, end)
        if (specifier.startsWith('./') || specifier.startsWith('../')) specifiers.push(specifier)
        index = line.indexOf(quote, end + 1)
      }
    }
  }
  return specifiers
}
