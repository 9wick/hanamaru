import type { CaseBlueprint, Fields } from '../../domain/definition/runtime.js'
import { configWith, defaultMiddlewareTimeoutMs } from '../../domain/execution/config.js'
import type { ExecutionNode, Plan } from '../../domain/execution/model.js'
import { diagnostic } from '../../domain/result/diagnostic.js'
import type {
  MutableAttempt,
  MutableCaseResult,
  MutableGroupResult,
  MutableNodeResult,
  MutableRunResult,
  Reason,
} from '../../domain/result/mutable.js'
import { required } from '../../foundation/value.js'
import type { Comparison } from '../ports/comparison.js'
import type { Executor } from '../ports/executor.js'
import { executeAttempt } from './attempt.js'
import { now } from './clock.js'
import { CaseFailed } from './faults.js'
import { executeGroupMiddleware } from './middleware.js'
import { allCases } from './plan.js'
import { ProgressStore } from './progress.js'
import type { AttemptServices } from './services.js'
import { RunEvents, RunTracker } from './services.js'
import type { InternalRunOptions } from './state.js'

type RunServices = AttemptServices & { readonly executor: Executor | null }

function executableMode(item: CaseBlueprint, only: boolean) {
  if (item.mode === 'todo') return 'todo'
  if (item.mode === 'skip' || (only && item.mode !== 'only')) return 'skipped'
  return null
}

function cancelledTree(node: ExecutionNode, path: number[], only: boolean): MutableNodeResult {
  if (node.kind === 'test')
    return {
      kind: 'test',
      name: node.bp.name,
      path,
      cases: node.bp.cases.map((item, index) => ({
        name: item.name,
        origin: item.origin,
        path: [...path, item.originalIndex ?? index],
        row: item.row ? { index: item.row.index, value: diagnostic(item.row.value) } : null,
        config: configWith(node.config, item.config),
        durationMs: 0,
        attempts: [],
        notRun: executableMode(item, only) ?? 'cancelled',
      })),
    }
  return {
    kind: 'group',
    name: node.bp.name,
    origin: node.bp.origin,
    middleware: node.bp.middleware
      ? { status: 'not-run', reason: 'cancelled', durationMs: 0, failures: [], cleanup: 'complete' }
      : null,
    path,
    children: node.children.map((child, index) => ({
      origin: required(child.entryOrigin),
      result: cancelledTree(child, [...path, child.originalIndex ?? index], only),
    })),
  }
}

async function runNode(
  node: ExecutionNode,
  path: number[],
  only: boolean,
  services: RunServices,
): Promise<MutableNodeResult> {
  const { tracker, events } = services
  if (node.kind === 'test') {
    const cases: MutableCaseResult[] = []
    for (const [index, item] of node.bp.cases.entries()) {
      const casePath = [...path, item.originalIndex ?? index]
      const base = {
        name: item.name,
        origin: item.origin,
        path: casePath,
        row: item.row ? { index: item.row.index, value: diagnostic(item.row.value) } : null,
        config: configWith(node.config, item.config),
      }
      const mode = executableMode(item, only)
      if (item.mode === 'todo' || mode || tracker.reason) {
        const value: MutableCaseResult = { ...base, durationMs: 0, attempts: [], notRun: mode ?? 'cancelled' }
        cases.push(value)
        recordCase(services, value)
        continue
      }
      const started = now(),
        attempts: MutableAttempt[] = []
      for (let number = 1; number <= base.config.retry + 1; number++) {
        tracker.begin({ kind: 'attempt', base, attempts, number, started: now(), timeoutMs: base.config.timeout })
        events.progress(tracker.activeProgress('interrupted'))
        events.deadline({
          kind: 'start',
          timeoutMs: base.config.timeout,
          progress: tracker.activeProgress('timeout'),
        })
        const { result, retryable } = services.executor
          ? await services.executor.attempt(casePath, number)
          : await executeAttempt(node, item, number, services)
        events.deadline({ kind: 'end' })
        tracker.end()
        attempts.push(result)
        if (result.status === 'passed' || tracker.reason || !retryable) break
      }
      const value = { ...base, durationMs: now() - started, attempts }
      cases.push(value)
      recordCase(services, value)
    }
    const value: MutableNodeResult = { kind: 'test', name: node.bp.name, path, cases }
    recordNode(services, value)
    return value
  }
  const result: MutableGroupResult = {
    kind: 'group',
    name: node.bp.name,
    origin: node.bp.origin,
    middleware: null,
    path,
    children: [],
  }
  const executeChildren = async (fields: Fields) => {
    const stable = { ...node.stable, ...fields }
    for (const [index, child] of node.children.entries()) {
      const frames = [...node.frames, { steps: [], fields }, ...child.frames.slice(node.frameCount)]
      const prepared = { ...child, stable, frames }
      result.children.push({
        origin: required(child.entryOrigin),
        result: tracker.reason
          ? cancelledTree(prepared, [...path, child.originalIndex ?? index], only)
          : await runNode(prepared, [...path, child.originalIndex ?? index], only, services),
      })
    }
    if (
      resultFailed(
        result.children.map((entry) => entry.result),
        false,
      )
    )
      throw new CaseFailed()
  }
  const runnable = allCases([node]).some((item) => !executableMode(item, only))
  if (!runnable) {
    result.middleware = node.bp.middleware
      ? { status: 'not-run', reason: 'no-runnable-cases', durationMs: 0, failures: [], cleanup: 'complete' }
      : null
    await executeChildren({})
    recordNode(services, result)
    return result
  }
  if (!node.bp.middleware || tracker.reason) {
    if (node.bp.middleware)
      result.middleware = { status: 'not-run', reason: 'cancelled', durationMs: 0, failures: [], cleanup: 'complete' }
    try {
      await executeChildren({})
    } catch (error) {
      if (!(error instanceof CaseFailed)) throw error
    }
    recordNode(services, result)
    return result
  }
  const started = now()
  const execution = services.executor
    ? await services.executor.group(path, async () => {
        try {
          await executeChildren({})
          return false
        } catch (error) {
          if (!(error instanceof CaseFailed)) throw error
          return true
        }
      })
    : await executeGroupMiddleware(node, executeChildren, services, (stage) => {
        if (stage === 'inside' || stage === 'end') events.deadline({ kind: 'end' })
        else {
          const timeoutMs = required(node.bp.middleware).timeout ?? defaultMiddlewareTimeoutMs
          tracker.begin({ kind: 'group', path, stage, started, timeoutMs })
          events.deadline({ kind: 'start', timeoutMs, progress: tracker.activeProgress('timeout') })
        }
      })
  result.middleware = execution.middleware
  if (execution.reason) tracker.abort(execution.reason)
  if (result.middleware.status === 'failed') {
    for (let index = result.children.length; index < node.children.length; index++) {
      const child = node.children[index]
      result.children.push({
        origin: required(child.entryOrigin),
        result: cancelledTree(child, [...path, child.originalIndex ?? index], only),
      })
    }
  }
  tracker.end()
  recordNode(services, result)
  return result
}

function resultFailed(nodes: MutableNodeResult[], failOnFlaky = false): boolean {
  for (const node of nodes) {
    if (node.kind === 'group') {
      if (
        node.middleware?.status === 'failed' ||
        resultFailed(
          node.children.map((x) => x.result),
          failOnFlaky,
        )
      )
        return true
    } else
      for (const item of node.cases) {
        const last = item.attempts.at(-1)
        if (last?.status === 'failed' || (failOnFlaky && last?.status === 'passed' && item.attempts.length > 1))
          return true
      }
  }
  return false
}

function recordNode(services: RunServices, value: MutableNodeResult) {
  services.tracker.recordNode(value)
  if (value.kind === 'group')
    services.events.progress({ kind: 'group', path: value.path, middleware: value.middleware })
}

function recordCase(services: RunServices, value: MutableCaseResult) {
  services.tracker.recordCase(value)
  services.events.progress({ kind: 'case', result: value })
}

function snapshotRun(tracker: RunTracker, reason: Reason): MutableRunResult {
  const store = new ProgressStore()
  store.apply({
    kind: 'init',
    result: structuredClone({
      version: 1,
      status: reason === 'timeout' ? 'failed' : resultFailed(tracker.results, false) ? 'failed' : 'cancelled',
      reason,
      tests: tracker.results,
    }),
  })
  if (tracker.active) store.apply(tracker.activeProgress(reason))
  return required(store.result)
}

let active = false

export async function runPlan(
  plan: Plan,
  options: InternalRunOptions,
  comparison: Comparison,
  executor: Executor | null = null,
) {
  return runActive(() => plan, options, comparison, executor)
}

export async function runActive(
  buildPlan: () => Plan,
  options: InternalRunOptions,
  comparison: Comparison,
  executor: Executor | null = null,
): Promise<MutableRunResult> {
  if (active) throw new TypeError('a run is already active')
  active = true
  try {
    const { nodes, only } = buildPlan()
    const tracker = new RunTracker(
      options.signal?.aborted ? 'interrupted' : null,
      nodes.map((node, index) => cancelledTree(node, [node.originalIndex ?? index], only)),
    )
    const events = new RunEvents({
      onProgress: options.onProgress,
      onDeadline: options.onDeadline,
      onTimeout: () => options.onTimeout?.(snapshotRun(tracker, 'timeout')),
    })
    const services: RunServices = { comparison, tracker, events, executor }
    events.progress({
      kind: 'init',
      result: { version: 1, status: 'cancelled', reason: 'interrupted', tests: tracker.results },
    })
    executor?.attach(tracker, events)
    const interrupt = () => tracker.interrupt()
    options.signal?.addEventListener('abort', interrupt)
    const results: MutableNodeResult[] = []
    try {
      for (const [index, node] of nodes.entries())
        results.push(
          tracker.reason
            ? cancelledTree(node, [node.originalIndex ?? index], only)
            : await runNode(node, [node.originalIndex ?? index], only, services),
        )
    } finally {
      options.signal?.removeEventListener('abort', interrupt)
    }
    const failed =
      resultFailed(results, options.failOnFlaky) || tracker.reason === 'timeout' || tracker.reason === 'cleanup-failed'
    return {
      version: 1,
      status: failed ? 'failed' : tracker.reason === 'interrupted' ? 'cancelled' : 'passed',
      reason: tracker.reason ?? 'completed',
      tests: results,
    }
  } finally {
    active = false
  }
}
