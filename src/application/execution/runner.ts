import type { CaseBlueprint, Fields } from '../../domain/definition/runtime.js'
import { defaultMiddlewareTimeoutMs } from '../../domain/execution/config.js'
import type { ExecutionNode, GroupNode, Plan, SuiteNode } from '../../domain/execution/model.js'
import type {
  MutableAttempt,
  MutableCaseResult,
  MutableGroupResult,
  MutableNodeResult,
  MutableRunResult,
  MutableTestResult,
  Reason,
} from '../../domain/result/mutable.js'
import { required } from '../../foundation/value.js'
import type { Comparison } from '../ports/comparison.js'
import type { Executor } from '../ports/executor.js'
import { executeAttempt } from './attempt.js'
import { now } from './clock.js'
import { runExclusively } from './current-run.js'
import { CaseFailed } from './faults.js'
import { executeGroupMiddleware } from './middleware.js'
import { allCases } from './plan.js'
import { ProgressStore } from './progress.js'
import { caseBase, cancelledTree, executableMode, notRunCase, notRunMiddleware, resultFailed } from './results.js'
import type { RunSettings } from './options.js'
import type { AttemptServices, RunListeners } from './services.js'
import { RunEvents, RunTracker } from './services.js'
import type { Progress } from './state.js'

type RunServices = AttemptServices & { readonly results: ProgressStore; readonly executor: Executor | null }

/** runが外から受け取るサービス。設定値はRunSettingsとして別に渡す。 */
export type RunDependencies = {
  readonly comparison: Comparison
  readonly executor?: Executor | null
  readonly signal?: AbortSignal
  readonly listeners?: RunListeners
}

/**
 * 確定した結果は、手元の部分結果ツリーと外向きの通知の両方に同じprogressで渡す。
 * 打ち切り時の結果は受け取り手がprogressから組み立てた木と一致していなければならないため、片方だけを更新しない。
 */
function publish(services: RunServices, progress: Progress): void {
  services.results.apply(progress)
  services.events.progress(progress)
}

async function runCase(
  node: SuiteNode,
  item: CaseBlueprint,
  index: number,
  path: number[],
  only: boolean,
  services: RunServices,
): Promise<MutableCaseResult> {
  const { tracker, events } = services
  const base = caseBase(node.config, item, index, path)
  const mode = executableMode(item, only)
  // todoを先に外すことで、以降のitemが実行に必要な定義を備えたcaseだと型でも決まる。
  if (item.mode === 'todo' || mode || tracker.reason) return notRunCase(base, mode ?? 'cancelled')
  const started = now(),
    attempts: MutableAttempt[] = []
  for (let number = 1; number <= base.config.retry + 1; number++) {
    tracker.begin({ kind: 'attempt', base, attempts, number, started: now(), timeoutMs: base.config.timeout })
    // 走り出す前に、いま中断されたらどう見えるかを知らせる。確定した結果ではないので手元には残さない。
    events.progress(tracker.activeProgress('interrupted'))
    events.deadline({ kind: 'start', timeoutMs: base.config.timeout, progress: tracker.activeProgress('timeout') })
    const { result, retryable } = services.executor
      ? await services.executor.attempt(base.path, number)
      : await executeAttempt(node, item, number, services)
    events.deadline({ kind: 'end' })
    tracker.end()
    attempts.push(result)
    if (result.status === 'passed' || tracker.reason || !retryable) break
  }
  return { ...base, durationMs: now() - started, attempts }
}

async function runTestNode(
  node: SuiteNode,
  path: number[],
  only: boolean,
  services: RunServices,
): Promise<MutableTestResult> {
  const cases: MutableCaseResult[] = []
  for (const [index, item] of node.bp.cases.entries()) {
    const value = await runCase(node, item, index, path, only, services)
    cases.push(value)
    publish(services, { kind: 'case', result: value })
  }
  return { kind: 'test', name: node.bp.name, path, cases }
}

async function runGroupNode(
  node: GroupNode,
  path: number[],
  only: boolean,
  services: RunServices,
): Promise<MutableGroupResult> {
  const { tracker, events } = services
  const children: MutableGroupResult['children'] = []
  const childPath = (child: ExecutionNode, index: number) => [...path, child.originalIndex ?? index]
  const group = (middleware: MutableGroupResult['middleware']): MutableGroupResult => ({
    kind: 'group',
    name: node.bp.name,
    origin: node.bp.origin,
    middleware,
    path,
    children,
  })
  const executeChildren = async (fields: Fields) => {
    const stable = { ...node.stable, ...fields }
    for (const [index, child] of node.children.entries()) {
      const frames = [...node.frames, { steps: [], fields }, ...child.frames.slice(node.frameCount)]
      const prepared = { ...child, stable, frames }
      children.push({
        origin: required(child.entryOrigin),
        result: tracker.reason
          ? cancelledTree(prepared, childPath(child, index), only)
          : await runNode(prepared, childPath(child, index), only, services),
      })
    }
    if (resultFailed(children.map((entry) => entry.result))) throw new CaseFailed()
  }
  const runnable = allCases([node]).some((item) => !executableMode(item, only))
  if (!runnable) {
    const middleware = node.bp.middleware ? notRunMiddleware('no-runnable-cases') : null
    await executeChildren({})
    return group(middleware)
  }
  if (!node.bp.middleware || tracker.reason) {
    const middleware = node.bp.middleware ? notRunMiddleware('cancelled') : null
    try {
      await executeChildren({})
    } catch (error) {
      if (!(error instanceof CaseFailed)) throw error
    }
    return group(middleware)
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
  if (execution.reason) tracker.abort(execution.reason)
  // middlewareが落ちた時点で残りの子は動かないため、実行しなかった姿で埋める。
  if (execution.middleware.status === 'failed')
    for (let index = children.length; index < node.children.length; index++) {
      const child = node.children[index]
      children.push({
        origin: required(child.entryOrigin),
        result: cancelledTree(child, childPath(child, index), only),
      })
    }
  tracker.end()
  return group(execution.middleware)
}

async function runNode(
  node: ExecutionNode,
  path: number[],
  only: boolean,
  services: RunServices,
): Promise<MutableNodeResult> {
  // testの中身はcaseごとに通知済みなので、節として追加で知らせるのはgroupのmiddlewareだけ。
  if (node.kind === 'test') return runTestNode(node, path, only, services)
  const value = await runGroupNode(node, path, only, services)
  publish(services, { kind: 'group', path, middleware: value.middleware })
  return value
}

/** いまの部分結果を、与えられた理由で打ち切った結果として複製する。実行中の1件も反映する。 */
function snapshotRun(results: ProgressStore, tracker: RunTracker, reason: Reason): MutableRunResult {
  const partial = required(results.result)
  const snapshot = new ProgressStore()
  snapshot.apply({
    kind: 'init',
    result: structuredClone({ ...partial, status: reason === 'timeout' ? 'failed' : partial.status, reason }),
  })
  if (tracker.active) snapshot.apply(tracker.activeProgress(reason))
  return required(snapshot.result)
}

export async function runPlan(plan: Plan, settings: RunSettings, dependencies: RunDependencies) {
  return runActive(() => plan, settings, dependencies)
}

/** 錠は計画の組み立てより先に取る。収集の途中で始まったrunも重なりとして弾く。 */
export async function runActive(
  buildPlan: () => Plan,
  settings: RunSettings,
  dependencies: RunDependencies,
): Promise<MutableRunResult> {
  return runExclusively(() => executeRun(buildPlan, settings, dependencies))
}

async function executeRun(
  buildPlan: () => Plan,
  settings: RunSettings,
  dependencies: RunDependencies,
): Promise<MutableRunResult> {
  const { comparison, executor = null, signal, listeners } = dependencies
  const { nodes, only } = buildPlan()
  const tracker = new RunTracker(signal?.aborted ? 'interrupted' : null)
  const results = new ProgressStore()
  const events = new RunEvents({
    onProgress: listeners?.onProgress,
    onDeadline: listeners?.onDeadline,
    onTimeout: () => listeners?.onTimeout?.(snapshotRun(results, tracker, 'timeout')),
  })
  const services: RunServices = { comparison, tracker, events, results, executor }
  // 実行前の結果は、全てを実行しなかった姿。ここから完了したものだけを差し替えていく。
  publish(services, {
    kind: 'init',
    result: {
      version: 1,
      status: 'cancelled',
      reason: 'interrupted',
      tests: nodes.map((node, index) => cancelledTree(node, [node.originalIndex ?? index], only)),
    },
  })
  executor?.attach(tracker, services.events)
  const interrupt = () => tracker.interrupt()
  signal?.addEventListener('abort', interrupt)
  const tests: MutableNodeResult[] = []
  try {
    for (const [index, node] of nodes.entries())
      tests.push(
        tracker.reason
          ? cancelledTree(node, [node.originalIndex ?? index], only)
          : await runNode(node, [node.originalIndex ?? index], only, services),
      )
  } finally {
    signal?.removeEventListener('abort', interrupt)
  }
  const failed =
    resultFailed(tests, settings.failOnFlaky) || tracker.reason === 'timeout' || tracker.reason === 'cleanup-failed'
  return {
    version: 1,
    status: failed ? 'failed' : tracker.reason === 'interrupted' ? 'cancelled' : 'passed',
    reason: tracker.reason ?? 'completed',
    tests,
  }
}
