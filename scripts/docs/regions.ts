import { normalizeNewlines, splitLines } from './markdown.ts'

export type Region = { readonly name: string; readonly start: number; readonly end: number }
export type RegionIssueKind =
  | 'unclosed-region'
  | 'mismatched-endregion'
  | 'duplicate-region'
  | 'invalid-region-name'
  | 'empty-region'
export type RegionIssue = { readonly kind: RegionIssueKind; readonly name: string; readonly line: number }
export type RegionParse = {
  readonly lines: readonly string[]
  readonly regions: ReadonlyMap<string, Region>
  readonly markers: ReadonlySet<number>
  readonly issues: readonly RegionIssue[]
}

const startKeyword = '// #region'
const endKeyword = '// #endregion'

export function isRegionName(name: string): boolean {
  return /^[a-z0-9-]+$/.test(name)
}

function markerName(trimmed: string, keyword: string): string | undefined {
  if (!trimmed.startsWith(keyword)) return undefined
  const rest = trimmed.slice(keyword.length)
  if (rest !== '' && !rest.startsWith(' ') && !rest.startsWith('\t')) return undefined
  return rest.trim()
}

export function parseRegions(text: string): RegionParse {
  const lines = splitLines(normalizeNewlines(text))
  const regions = new Map<string, Region>()
  const markers = new Set<number>()
  const issues: RegionIssue[] = []
  const open: { name: string; start: number; valid: boolean }[] = []
  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim()
    const closing = markerName(trimmed, endKeyword)
    if (closing !== undefined) {
      markers.add(index)
      const current = open.pop()
      if (current === undefined || current.name !== closing) {
        issues.push({ kind: 'mismatched-endregion', name: closing, line: index + 1 })
        // 対応が取れないので開いていた範囲は捨て、以降の行を素直に読み進める。
        if (current !== undefined) issues.push({ kind: 'unclosed-region', name: current.name, line: current.start + 1 })
        continue
      }
      if (!current.valid) continue
      const region = { name: current.name, start: current.start, end: index }
      regions.set(current.name, region)
      if (renderLines(lines, markers, current.start + 1, index) === '')
        issues.push({ kind: 'empty-region', name: current.name, line: current.start + 1 })
      continue
    }
    const opening = markerName(trimmed, startKeyword)
    if (opening === undefined) continue
    markers.add(index)
    if (!isRegionName(opening)) {
      issues.push({ kind: 'invalid-region-name', name: opening, line: index + 1 })
      open.push({ name: opening, start: index, valid: false })
      continue
    }
    const duplicate = regions.has(opening) || open.some((entry) => entry.name === opening)
    if (duplicate) issues.push({ kind: 'duplicate-region', name: opening, line: index + 1 })
    open.push({ name: opening, start: index, valid: !duplicate })
  }
  for (const entry of open) issues.push({ kind: 'unclosed-region', name: entry.name, line: entry.start + 1 })
  return { lines, regions, markers, issues }
}

export function renderRegion(parse: RegionParse, region: Region): string {
  return renderLines(parse.lines, parse.markers, region.start + 1, region.end)
}

export function renderFile(parse: RegionParse): string {
  const body: string[] = []
  for (let index = 0; index < parse.lines.length; index++) if (!parse.markers.has(index)) body.push(parse.lines[index])
  return body.join('\n').trim()
}

function renderLines(lines: readonly string[], markers: ReadonlySet<number>, from: number, to: number): string {
  const body: string[] = []
  for (let index = from; index < to; index++) if (!markers.has(index)) body.push(lines[index])
  return trimBlankEdges(dedent(body)).join('\n')
}

// 空行はインデント計算から除く。タブと空白が混在しても、削るのは先頭の空白文字だけになる。
function dedent(lines: readonly string[]): readonly string[] {
  let minimum = -1
  for (const line of lines) {
    if (line.trim() === '') continue
    const indent = line.length - line.trimStart().length
    if (minimum < 0 || indent < minimum) minimum = indent
  }
  if (minimum <= 0) return lines
  return lines.map((line) => (line.trim() === '' ? '' : line.slice(minimum)))
}

function trimBlankEdges(lines: readonly string[]): readonly string[] {
  let start = 0
  let end = lines.length
  while (start < end && lines[start].trim() === '') start++
  while (end > start && lines[end - 1].trim() === '') end--
  return lines.slice(start, end)
}
