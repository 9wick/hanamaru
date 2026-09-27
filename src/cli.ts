#!/usr/bin/env node

import type { DiagnosticValue, SourceLocation, TargetOutcome } from './api.js'
import type { CliOptions, MutableRunResult, MutableCaseResult, MutableNodeResult } from './internal.js'
import { errorMessage } from './shared.js'
import * as v from 'valibot'
import { cliMessageSchema } from './schemas.js'
import { Worker } from 'node:worker_threads'
import { inspect } from 'node:util'
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'

const { version } = v.parse(
  v.object({ version: v.string() }),
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')),
)
function parse(argv: string[]) {
  const options: CliOptions = {},
    files: string[] = []
  const mapped: Record<string, 'filter' | 'reporter' | 'config' | 'collectionTimeout' | 'shutdownGrace'> = {
    '-t': 'filter',
    '--filter': 'filter',
    '-r': 'reporter',
    '--reporter': 'reporter',
    '-c': 'config',
    '--config': 'config',
    '--collection-timeout': 'collectionTimeout',
    '--shutdown-grace': 'shutdownGrace',
  }
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i]
    if (word in mapped) {
      const value = argv[++i]
      if (!value || value.startsWith('-')) throw new TypeError(`${word} requires a value`)
      const key = mapped[word]
      if (key === 'collectionTimeout' || key === 'shutdownGrace') options[key] = Number(value)
      else options[key] = value
    } else if (word === '--ci') options.ci = true
    else if (word === '--fail-on-flaky') options.failOnFlaky = true
    else if (word === '--no-color') options.noColor = true
    else if (word === '--help' || word === '-h') options.help = true
    else if (word === '--version' || word === '-v') options.version = true
    else if (word.startsWith('-')) throw new TypeError(`unknown option: ${word}`)
    else files.push(word)
  }
  return { options, files }
}
function formatValue(value: DiagnosticValue | TargetOutcome | string): string {
  if (!value || typeof value !== 'object') return inspect(value)
  switch (value.kind) {
    case 'undefined':
      return 'undefined'
    case 'null':
      return 'null'
    case 'hole':
      return '<hole>'
    case 'number':
    case 'bigint':
    case 'boolean':
      return String(value.value)
    case 'string':
      return JSON.stringify(value.value)
    case 'symbol':
      return `Symbol(${value.description ?? ''})#${value.id}`
    case 'function':
      return `[Function ${value.name || '<anonymous>'}]`
    case 'reference':
      return `[Reference #${value.id}]`
    case 'date':
      return `Date(${value.value ?? 'Invalid'})`
    case 'regexp':
      return `/${value.source}/${value.flags}`
    case 'accessor':
      return `[accessor get=${value.get} set=${value.set}]`
    case 'omitted':
      return `[omitted: ${value.reason}]`
    case 'array':
      return `[${value.items.map(formatValue).join(', ')}]`
    case 'map':
      return `Map(${value.entries.map(([key, item]) => `${formatValue(key)} => ${formatValue(item)}`).join(', ')})`
    case 'set':
      return `Set(${value.values.map(formatValue).join(', ')})`
    case 'object':
      return `${value.type === 'Object' ? '' : value.type}{ ${value.properties
        .filter((p) => p.key.kind !== 'string' || p.key.value !== 'stack')
        .map((p) => `${p.key.kind === 'string' ? p.key.value : formatValue(p.key)}: ${formatValue(p.value)}`)
        .join(', ')} }`
    default:
      return inspect(value)
  }
}
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
function formatNode(node: MutableNodeResult, depth = 0, groupOrigins: SourceLocation[] = []): string[] {
  const lines: string[] = [],
    pad = '  '.repeat(depth)
  if (node.kind === 'group') {
    if (node.name !== null) lines.push(`${pad}${node.name}`)
    if (node.middleware?.status === 'failed')
      for (const issue of node.middleware.failures) {
        lines.push(
          `${pad}  ✗ group middleware: ${issue.message}  ${relative(process.cwd(), node.origin.file)}:${node.origin.line}:${node.origin.column}`,
        )
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
async function main(): Promise<number> {
  const { options, files } = parse(process.argv.slice(2))
  if (options.version) {
    process.stdout.write(`${version}\n`)
    return 0
  }
  if (options.help) {
    process.stdout.write(
      'hanamaru [files...] [--filter text] [--reporter pretty|json] [--config file] [--ci] [--fail-on-flaky] [--collection-timeout ms] [--shutdown-grace ms]\n',
    )
    return 0
  }
  const worker = new Worker(new URL('./cli-worker.js', import.meta.url), { workerData: { options, files } })
  let loadingTimer: ReturnType<typeof setTimeout> | undefined
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  let grace = 1_000,
    complete = false,
    interrupted = false,
    reporter = options.reporter
  let partial: MutableRunResult | null = null
  const done = new Promise<number>((resolve, reject) => {
    const printResult = (result: MutableRunResult) => {
      if (reporter === 'json') process.stdout.write(`${JSON.stringify(result)}\n`)
      else process.stdout.write(result.tests.flatMap((node) => formatNode(node)).join('\n') + '\n')
    }
    const finish = (code: number) => {
      if (complete) return
      complete = true
      clearTimeout(loadingTimer)
      clearTimeout(deadlineTimer)
      clearTimeout(graceTimer)
      process.off('SIGINT', interrupt)
      worker.terminate().then(() => resolve(code), reject)
    }
    const interrupt = () => {
      interrupted = true
      process.stderr.write('hanamaru: interrupted\n')
      worker.postMessage({ type: 'interrupt' })
      if (!graceTimer)
        graceTimer = setTimeout(() => {
          if (partial)
            printResult({
              ...partial,
              status: partial.status === 'failed' ? 'failed' : 'cancelled',
              reason: 'interrupted',
            })
          finish(130)
        }, grace)
    }
    process.on('SIGINT', interrupt)
    worker.on('message', (input) => {
      if (complete) return
      const message = v.parse(cliMessageSchema, input)
      if (message.type === 'loading') {
        clearTimeout(loadingTimer)
        loadingTimer = setTimeout(() => {
          process.stderr.write(`hanamaru: collection timeout: ${message.file} (${message.timeout}ms)\n`)
          finish(interrupted ? 130 : 2)
        }, message.timeout)
      } else if (message.type === 'running') {
        clearTimeout(loadingTimer)
        grace = message.shutdownGrace
        reporter = message.reporter
      } else if (message.type === 'progress') {
        partial = message.result
      } else if (message.type === 'deadline') {
        clearTimeout(deadlineTimer)
        if (message.kind === 'start')
          deadlineTimer = setTimeout(() => {
            partial = message.result
            if (!graceTimer)
              graceTimer = setTimeout(() => {
                process.stderr.write(`hanamaru: shutdown grace exceeded (${grace}ms)\n`)
                if (partial) printResult(partial)
                finish(interrupted ? 130 : 1)
              }, grace)
          }, message.timeoutMs)
      } else if (message.type === 'timeout') {
        clearTimeout(deadlineTimer)
        partial = message.result
        if (!graceTimer)
          graceTimer = setTimeout(() => {
            process.stderr.write(`hanamaru: shutdown grace exceeded (${grace}ms)\n`)
            if (partial) printResult(partial)
            finish(interrupted ? 130 : 1)
          }, grace)
      } else if (message.type === 'result') {
        reporter = message.reporter
        printResult(message.result)
        finish(interrupted ? 130 : message.result.status === 'passed' ? 0 : 1)
      } else if (message.type === 'error') {
        process.stderr.write(`hanamaru: ${message.message}\n`)
        finish(interrupted ? 130 : 2)
      }
    })
    worker.on('error', (error) => {
      process.stderr.write(`hanamaru: ${error.stack ?? error}\n`)
      finish(interrupted ? 130 : 2)
    })
    worker.on('exit', (code) => {
      if (!complete) {
        process.stderr.write(`hanamaru: worker exited (${code})\n`)
        finish(interrupted ? 130 : 2)
      }
    })
  })
  return done
}
try {
  process.exitCode = await main()
} catch (error) {
  process.stderr.write(`hanamaru: ${errorMessage(error)}\n`)
  process.exitCode = 2
}
