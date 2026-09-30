import { relative } from 'node:path'
import type { SourceLocation } from '../../../domain/definition/types.js'
import type { MutableCaseResult, MutableNodeResult } from '../../../domain/result/mutable.js'
import { formatValue } from './format-value.js'

function formatFailure(item: MutableCaseResult, depth: number, groupOrigins: SourceLocation[]) {
  const out: string[] = [],
    pad = '  '.repeat(depth)
  if (item.row) out.push(`${pad}row ${item.row.index + 1}: ${formatValue(item.row.value)}`)
  for (const origin of groupOrigins)
    out.push(`${pad}group: ${relative(process.cwd(), origin.file)}:${origin.line}:${origin.column}`)
  for (const attempt of item.attempts)
    for (const issue of attempt.failures) {
      const ref = 'assertion' in issue ? issue.assertion : undefined
      const label = ref
        ? `${ref.source === 'expectCalls' ? `call(${ref.key})` : ref.subject}.${ref.matcher}`
        : issue.message
      out.push(`${pad}${label}`)
      if ('expected' in issue) out.push(`${pad}  expected: ${formatValue(issue.expected)}`)
      if ('actual' in issue) out.push(`${pad}  actual:   ${formatValue(issue.actual)}`)
      if ('timeoutMs' in issue)
        out.push(`${pad}  timeout: ${issue.timeoutMs}ms (${issue.phase}${issue.stage ? ` ${issue.stage}` : ''})`)
      if ('cause' in issue) out.push(`${pad}  cause:   ${formatValue(issue.cause)}`)
    }
  return out
}

export function formatNode(node: MutableNodeResult, depth = 0, groupOrigins: SourceLocation[] = []): string[] {
  const lines: string[] = [],
    pad = '  '.repeat(depth)
  if (node.kind === 'group') {
    if (node.name !== null) lines.push(`${pad}${node.name}`)
    if (node.middleware?.status === 'failed')
      for (const issue of node.middleware.failures) {
        lines.push(
          `${pad}  ✗ group middleware: ${issue.message}  ${relative(process.cwd(), node.origin.file)}:${node.origin.line}:${node.origin.column}`,
        )
        if ('cause' in issue) lines.push(`${pad}    cause: ${formatValue(issue.cause)}`)
        if ('timeoutMs' in issue) lines.push(`${pad}    timeout: ${issue.timeoutMs}ms (${issue.phase})`)
      }
    for (const entry of node.children)
      lines.push(...formatNode(entry.result, depth + (node.name === null ? 0 : 1), [...groupOrigins, entry.origin]))
  } else {
    lines.push(`${pad}${node.name}`)
    for (const item of node.cases) {
      const last = item.attempts.at(-1)
      const label =
        item.notRun === 'todo'
          ? '○'
          : item.notRun === 'skipped'
            ? '−'
            : item.notRun === 'cancelled'
              ? '!'
              : last?.status === 'passed'
                ? item.attempts.length > 1
                  ? '⚠'
                  : '✓'
                : last?.status === 'cancelled'
                  ? '!'
                  : '✗'
      const source =
        label === '✗' ? `  ${relative(process.cwd(), item.origin.file)}:${item.origin.line}:${item.origin.column}` : ''
      lines.push(`${pad}  ${label} ${item.name}${source}`)
      if (label === '✗' || label === '⚠') lines.push(...formatFailure(item, depth + 2, groupOrigins))
    }
  }
  return lines
}
