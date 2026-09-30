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
import { failure } from './assertions.js'
import { executeAttempt } from './attempt.js'
import { now } from './clock.js'
import { CaseFailed } from './faults.js'
import { executeGroupMiddleware } from './middleware.js'
import { allCases } from './plan.js'
import { ProgressStore } from './progress.js'
import type { InternalRunOptions, Progress, RunState } from './state.js'

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
  state: RunState,
): Promise<MutableNodeResult> {
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
      if (item.mode === 'todo' || mode || state.reason) {
        const value: MutableCaseResult = { ...base, durationMs: 0, attempts: [], notRun: mode ?? 'cancelled' }
        cases.push(value)
        recordCase(state, value)
        continue
      }
      const started = now(),
        attempts: MutableAttempt[] = []
      for (let number = 1; number <= base.config.retry + 1; number++) {
        state.activeAttempt = {
          path: casePath,
          base,
          attempts,
          number,
          started: now(),
          timeoutMs: base.config.timeout,
          phase: 'middleware',
        }
        state.onProgress?.(activeProgress(state, 'interrupted'))
        state.onDeadline?.({
          kind: 'start',
          timeoutMs: base.config.timeout,
          progress: activeProgress(state, 'timeout'),
        })
        const { result, retryable } = state.executor
          ? await state.executor.attempt(casePath, number)
          : await executeAttempt(node, item, number, state)
        state.onDeadline?.({ kind: 'end' })
        state.activeAttempt = null
        attempts.push(result)
        if (result.status === 'passed' || state.reason || !retryable) break
      }
      const value = { ...base, durationMs: now() - started, attempts }
      cases.push(value)
      recordCase(state, value)
    }
    const value: MutableNodeResult = { kind: 'test', name: node.bp.name, path, cases }
    recordNode(state, value)
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
        result: state.reason
          ? cancelledTree(prepared, [...path, child.originalIndex ?? index], only)
          : await runNode(prepared, [...path, child.originalIndex ?? index], only, state),
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
    recordNode(state, result)
    return result
  }
  if (!node.bp.middleware || state.reason) {
    if (node.bp.middleware)
      result.middleware = { status: 'not-run', reason: 'cancelled', durationMs: 0, failures: [], cleanup: 'complete' }
    try {
      await executeChildren({})
    } catch (error) {
      if (!(error instanceof CaseFailed)) throw error
    }
    recordNode(state, result)
    return result
  }
  const started = now()
  const execution = state.executor
    ? await state.executor.group(path, async () => {
        try {
          await executeChildren({})
          return false
        } catch (error) {
          if (!(error instanceof CaseFailed)) throw error
          return true
        }
      })
    : await executeGroupMiddleware(node, executeChildren, state, (stage) => {
        if (stage === 'inside' || stage === 'end') state.onDeadline?.({ kind: 'end' })
        else {
          state.activeGroup = {
            path,
            stage,
            started,
            timeoutMs: required(node.bp.middleware).timeout ?? defaultMiddlewareTimeoutMs,
          }
          state.onDeadline?.({
            kind: 'start',
            timeoutMs: required(node.bp.middleware).timeout ?? defaultMiddlewareTimeoutMs,
            progress: activeProgress(state, 'timeout'),
          })
        }
      })
  result.middleware = execution.middleware
  if (execution.reason) state.reason = execution.reason
  if (result.middleware.status === 'failed') {
    for (let index = result.children.length; index < node.children.length; index++) {
      const child = node.children[index]
      result.children.push({
        origin: required(child.entryOrigin),
        result: cancelledTree(child, [...path, child.originalIndex ?? index], only),
      })
    }
  }
  state.activeGroup = null
  recordNode(state, result)
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

function samePath(left: number[], right: number[]) {
  return left.length === right.length && left.every((part, index) => part === right[index])
}

function findNode(nodes: MutableNodeResult[], path: number[]): MutableNodeResult | null {
  for (const node of nodes) {
    if (samePath(node.path, path)) return node
    if (node.kind === 'group') {
      const found = findNode(
        node.children.map((entry) => entry.result),
        path,
      )
      if (found) return found
    }
  }
  return null
}

function recordNode(state: RunState, value: MutableNodeResult) {
  const path = value.path
  // state.partialは実行ツリーと同じ形で事前構築されるため、見つからないのは両者のずれを意味する
  if (path.length === 1) {
    const index = state.partial.findIndex((node) => samePath(node.path, path))
    if (index < 0) throw new Error(`result node not found: ${path.join('.')}`)
    state.partial[index] = value
  } else {
    const parent = findNode(state.partial, path.slice(0, -1))
    const entry =
      parent?.kind === 'group' ? parent.children.find((child) => samePath(child.result.path, path)) : undefined
    if (!entry) throw new Error(`result node not found: ${path.join('.')}`)
    entry.result = value
  }
  if (value.kind === 'group') state.onProgress?.({ kind: 'group', path: value.path, middleware: value.middleware })
}

function recordCase(state: RunState, value: MutableCaseResult) {
  const parent = findNode(state.partial, value.path.slice(0, -1))
  if (parent?.kind !== 'test') throw new Error(`result case parent not found: ${value.path.join('.')}`)
  const index = parent.cases.findIndex((item) => samePath(item.path, value.path))
  if (index < 0) throw new Error(`result case not found: ${value.path.join('.')}`)
  parent.cases[index] = value
  state.onProgress?.({ kind: 'case', result: value })
}

function activeProgress(state: RunState, reason: Reason): Progress {
  if (state.activeAttempt) {
    const { base, attempts, number, started, timeoutMs, phase } = state.activeAttempt
    return {
      kind: 'case',
      result: {
        ...base,
        durationMs: now() - started,
        attempts: [
          ...attempts,
          {
            attempt: number,
            status: reason === 'timeout' ? 'failed' : 'cancelled',
            durationMs: now() - started,
            outcome: null,
            assertions: [],
            failures:
              reason === 'timeout'
                ? [failure('timeout', phase, `attempt exceeded ${timeoutMs}ms`, { timeoutMs, cleanup: 'incomplete' })]
                : [],
            cleanup: 'incomplete',
          },
        ],
      },
    }
  }
  const group = required(state.activeGroup, 'no active execution for progress')
  return {
    kind: 'group',
    path: group.path,
    middleware: {
      status: reason === 'timeout' ? 'failed' : 'cancelled',
      durationMs: now() - group.started,
      cleanup: 'incomplete',
      failures:
        reason === 'timeout'
          ? [
              {
                kind: 'timeout',
                phase: group.stage,
                timeoutMs: group.timeoutMs,
                message: `group middleware exceeded ${group.timeoutMs}ms`,
              },
            ]
          : [],
    },
  }
}

function snapshotRun(state: RunState, reason: Reason): MutableRunResult {
  const store = new ProgressStore()
  store.apply({
    kind: 'init',
    result: structuredClone({
      version: 1,
      status: reason === 'timeout' ? 'failed' : resultFailed(state.partial, false) ? 'failed' : 'cancelled',
      reason,
      tests: state.partial,
    }),
  })
  if (state.activeAttempt || state.activeGroup) store.apply(activeProgress(state, reason))
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
    const state: RunState = {
      comparison,
      reason: options.signal?.aborted ? 'interrupted' : null,
      partial: [],
      activeAttempt: null,
      activeGroup: null,
      onProgress: options.onProgress,
      onDeadline: options.onDeadline,
      executor,
    }
    state.partial = nodes.map((node, index) => cancelledTree(node, [node.originalIndex ?? index], only))
    state.onProgress?.({
      kind: 'init',
      result: { version: 1, status: 'cancelled', reason: 'interrupted', tests: state.partial },
    })
    state.onTimeout = () => options.onTimeout?.(snapshotRun(state, 'timeout'))
    executor?.attach(state, (reason) => activeProgress(state, reason))
    const interrupt = () => {
      if (state.reason !== 'timeout') state.reason = 'interrupted'
    }
    options.signal?.addEventListener('abort', interrupt)
    const results: MutableNodeResult[] = []
    try {
      for (const [index, node] of nodes.entries())
        results.push(
          state.reason
            ? cancelledTree(node, [node.originalIndex ?? index], only)
            : await runNode(node, [node.originalIndex ?? index], only, state),
        )
    } finally {
      options.signal?.removeEventListener('abort', interrupt)
    }
    const failed =
      resultFailed(results, options.failOnFlaky) || state.reason === 'timeout' || state.reason === 'cleanup-failed'
    return {
      version: 1,
      status: failed ? 'failed' : state.reason === 'interrupted' ? 'cancelled' : 'passed',
      reason: state.reason ?? 'completed',
      tests: results,
    }
  } finally {
    active = false
  }
}
