import { relative } from 'node:path'
import type { SourceLocation } from '@hanamaru/blueprint/model'
import type {
  MutableCaseResult,
  MutableNodeResult,
  MutableResourceResult,
} from '@hanamaru/runner/domain/result/mutable'
import { formatValue } from './format-value.js'
import { formatDiff, formatPath } from './diff.js'

function detail(label: string, value: Parameters<typeof formatValue>[0], pad: string): string[] {
  const [first, ...rest] = formatValue(value).split('\n')
  return [`${pad}${label}${first}`, ...rest.map((line) => `${pad}  ${line}`)]
}

function formatFailure(item: MutableCaseResult, depth: number, groupOrigins: SourceLocation[]) {
  const out: string[] = [],
    pad = '  '.repeat(depth)
  if (item.row) out.push(`${pad}row ${item.row.index + 1}: ${formatValue(item.row.value)}`)
  for (const origin of groupOrigins)
    out.push(`${pad}group: ${relative(process.cwd(), origin.file)}:${origin.line}:${origin.column}`)
  for (const attempt of item.attempts) {
    for (const [failureIndex, issue] of attempt.failures.entries()) {
      const ref = 'assertion' in issue ? issue.assertion : undefined
      const path = ref?.path ? formatPath(ref.path) : ''
      const operationIndex = 'operationIndex' in issue ? issue.operationIndex : ref?.operationIndex
      const evaluation = attempt.evaluations?.find((item) => item.failureIndexes.includes(failureIndex))
      if (attempt.property && evaluation) {
        const evaluationIndex = attempt.evaluations?.indexOf(evaluation) ?? 0
        const shrinkIndex =
          attempt.evaluations?.slice(0, evaluationIndex + 1).filter((entry) => entry.kind === 'shrink').length ?? 0
        out.push(
          `${pad}${evaluation.kind} evaluation ${evaluationIndex + 1} (sample ${(evaluation.sampleIndex ?? 0) + 1}${evaluation.kind === 'shrink' ? `, shrink ${shrinkIndex}` : ''})`,
        )
        out.push(...detail('input: ', evaluation.input, `${pad}  `))
      }
      const operations = evaluation?.operations ?? attempt.operations
      const operation = operationIndex === undefined ? undefined : operations?.[operationIndex]
      const label = ref
        ? `${ref.subject}${path ? `${path.startsWith('[') ? '' : '.'}${path}` : ''}.${ref.matcher}${ref.evidence ? ` (${ref.evidence})` : ''}`
        : issue.message
      if (operationIndex !== undefined)
        out.push(`${pad}operation ${operationIndex + 1}${operation ? `: ${operation.key}` : ''}`)
      out.push(`${pad}${label}`)
      if (ref && issue.message !== 'condition did not match') out.push(`${pad}  reason: ${issue.message}`)
      if (ref?.adapterType) out.push(...detail('adapter type: ', ref.adapterType, `${pad}  `))
      for (const type of ref?.errorTypes ?? []) out.push(...detail('error type: ', type, `${pad}  `))
      if (issue.kind === 'observation')
        out.push(
          `${pad}  observation ${issue.stage} failed (token ${issue.observation.tokenId}, ref ${issue.observation.refId})`,
        )
      for (const observation of issue.kind === 'observation' ? [issue.observation] : (ref?.observations ?? [])) {
        const evidence = ref?.evidence === observation.evidence ? '' : ` (${observation.evidence})`
        if (observation.kind === 'action') {
          out.push(
            `${pad}  action ${observation.window.kind === 'settled' ? 'until target settles' : `${observation.window.milliseconds}ms after target`}${evidence}`,
          )
        } else {
          const timing = observation.timing
          out.push(
            `${pad}  state ${timing.kind === 'after-step' ? `after operation ${timing.operationIndex + 1}` : timing.kind}${evidence}`,
          )
          if (timing.kind === 'after-plan' && timing.wait)
            out.push(`${pad}  wait: ${timing.wait.withinMs}ms, interval: ${timing.wait.intervalMs}ms`)
          observation.args.forEach((arg, index) => out.push(...detail(`args[${index}]: `, arg, `${pad}  `)))
        }
      }
      const diff =
        issue.kind === 'assertion' && issue.assertion.matcher === 'toEqual'
          ? formatDiff(issue.expected, issue.actual, 'path' in issue.assertion ? issue.assertion.path : undefined)
          : []
      if (diff.length) out.push(...diff.map((line) => `${pad}  ${line}`))
      else {
        if ('expected' in issue) out.push(...detail('expected: ', issue.expected, `${pad}  `))
        if ('actual' in issue) out.push(...detail('actual:   ', issue.actual, `${pad}  `))
      }
      if ('timeoutMs' in issue)
        out.push(`${pad}  timeout: ${issue.timeoutMs}ms (${issue.phase}${issue.stage ? ` ${issue.stage}` : ''})`)
      if ('cause' in issue) out.push(...detail('cause:   ', issue.cause, `${pad}  `))
    }
  }
  return out
}

function formatPropertyRuns(item: MutableCaseResult, pad: string): string[] {
  return item.attempts.flatMap((attempt, index) => {
    const property = attempt.property
    if (!property) return []
    const evaluations = attempt.evaluations ?? []
    const generated = evaluations.filter((e) => e.kind === 'generated').length
    const shrinks = evaluations.filter((e) => e.kind === 'shrink').length
    const lines = [
      `${pad}property ${property.classification} (attempt ${index + 1}): seed ${property.seed}, generator v${property.version}`,
      `${pad}runs: ${generated}/${property.runs}, shrink evaluations: ${shrinks}/${property.maxShrinks}; stopped: ${property.stopped}`,
    ]
    lines.push(...detail('input range: ', property.source, pad))
    if (property.originalCounterexample !== null)
      lines.push(...detail('original counterexample: ', property.originalCounterexample, pad))
    if (property.counterexample !== null) lines.push(...detail('counterexample: ', property.counterexample, pad))
    if (property.shrinkPath.length) lines.push(`${pad}shrink path: ${property.shrinkPath.join(', ')}`)
    return lines
  })
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
        if ('cause' in issue) lines.push(...detail('cause: ', issue.cause, `${pad}    `))
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
      lines.push(...formatPropertyRuns(item, `${pad}    `))
      if (label === '✗' || label === '⚠') lines.push(...formatFailure(item, depth + 2, groupOrigins))
    }
  }
  return lines
}

export function formatResources(resources: readonly MutableResourceResult[] = []): string[] {
  return resources.flatMap((r) =>
    r.middleware.status === 'failed'
      ? r.middleware.failures.flatMap((issue) => [
          `✗ resource ${r.name} (${r.scope}): ${issue.message}`,
          ...('cause' in issue ? detail('cause: ', issue.cause, '  ') : []),
          ...('timeoutMs' in issue ? [`  timeout: ${issue.timeoutMs}ms (${issue.phase})`] : []),
        ])
      : [],
  )
}
