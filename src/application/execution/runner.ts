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
} from '../../domain/result/mutable.js'
import { required } from '../../foundation/value.js'
import type { Comparison } from '../ports/comparison.js'
import type { Executor } from '../ports/executor.js'
import { AttemptExecutor } from './attempt.js'
import { now } from './clock.js'
import { runExclusively } from './current-run.js'
import { CaseFailed } from './faults.js'
import { GroupMiddlewareExecutor } from './middleware.js'
import { allCases } from './plan.js'
import type { ProgressStore } from './progress.js'
import { caseBase, cancelledTree, executableMode, notRunCase, notRunMiddleware, resultFailed } from './results.js'
import type { RunSettings } from './options.js'
import type { RunEvents, RunServices, RunTracker } from './services.js'
import { CallBinder } from './services.js'
import type { Progress } from './state.js'

/**
 * 計画を辿って1回のrunを進める。何を辿るか・設定・中断の合図は実行ごとに決まるため引数で受け取る。
 * 実行場所を持つrunはattemptとgroupをそこへ渡し、持たないrunは手元の実行サービスで走らせる。
 */
export class RunWalker {
  readonly #results: ProgressStore
  readonly #events: RunEvents
  readonly #tracker: RunTracker
  readonly #attempts: AttemptExecutor
  readonly #groups: GroupMiddlewareExecutor
  readonly #executor: Executor | null

  constructor(
    results: ProgressStore,
    events: RunEvents,
    tracker: RunTracker,
    attempts: AttemptExecutor,
    groups: GroupMiddlewareExecutor,
    executor: Executor | null,
  ) {
    this.#results = results
    this.#events = events
    this.#tracker = tracker
    this.#attempts = attempts
    this.#groups = groups
    this.#executor = executor
  }

  /** 錠は計画の組み立てより先に取る。収集の途中で始まったrunも重なりとして弾く。 */
  async run(buildPlan: () => Plan, settings: RunSettings, signal?: AbortSignal): Promise<MutableRunResult> {
    return runExclusively(() => this.#execute(buildPlan, settings, signal))
  }

  /**
   * 確定した結果は、手元の部分結果ツリーと外向きの通知の両方に同じprogressで渡す。
   * 打ち切り時の結果は受け取り手がprogressから組み立てた木と一致していなければならないため、片方だけを更新しない。
   */
  #publish(progress: Progress): void {
    this.#results.apply(progress)
    this.#events.progress(progress)
  }

  async #execute(buildPlan: () => Plan, settings: RunSettings, signal?: AbortSignal): Promise<MutableRunResult> {
    const { nodes, only } = buildPlan()
    const tracker = this.#tracker
    // 走り出す前に中断されていた実行は、1件も動かさずに打ち切った姿で返す。
    if (signal?.aborted) tracker.interrupt()
    // 実行前の結果は、全てを実行しなかった姿。ここから完了したものだけを差し替えていく。
    this.#publish({
      kind: 'init',
      result: {
        version: 1,
        status: 'cancelled',
        reason: 'interrupted',
        tests: nodes.map((node, index) => cancelledTree(node, [node.originalIndex ?? index], only)),
      },
    })
    const interrupt = () => tracker.interrupt()
    signal?.addEventListener('abort', interrupt)
    const tests: MutableNodeResult[] = []
    try {
      for (const [index, node] of nodes.entries())
        tests.push(
          tracker.reason
            ? cancelledTree(node, [node.originalIndex ?? index], only)
            : await this.#node(node, [node.originalIndex ?? index], only),
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

  async #node(node: ExecutionNode, path: number[], only: boolean): Promise<MutableNodeResult> {
    // testの中身はcaseごとに通知済みなので、節として追加で知らせるのはgroupのmiddlewareだけ。
    if (node.kind === 'test') return this.#test(node, path, only)
    const value = await this.#group(node, path, only)
    this.#publish({ kind: 'group', path, middleware: value.middleware })
    return value
  }

  async #test(node: SuiteNode, path: number[], only: boolean): Promise<MutableTestResult> {
    const cases: MutableCaseResult[] = []
    for (const [index, item] of node.bp.cases.entries()) {
      const value = await this.#case(node, item, index, path, only)
      cases.push(value)
      this.#publish({ kind: 'case', result: value })
    }
    return { kind: 'test', name: node.bp.name, path, cases }
  }

  async #group(node: GroupNode, path: number[], only: boolean): Promise<MutableGroupResult> {
    const tracker = this.#tracker
    const events = this.#events
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
            : await this.#node(prepared, childPath(child, index), only),
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
    const execution = this.#executor
      ? await this.#executor.group(path, async () => {
          try {
            await executeChildren({})
            return false
          } catch (error) {
            if (!(error instanceof CaseFailed)) throw error
            return true
          }
        })
      : await this.#groups.execute(node, executeChildren, (stage) => {
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

  async #case(
    node: SuiteNode,
    item: CaseBlueprint,
    index: number,
    path: number[],
    only: boolean,
  ): Promise<MutableCaseResult> {
    const tracker = this.#tracker
    const events = this.#events
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
      const { result, retryable } = this.#executor
        ? await this.#executor.attempt(base.path, number)
        : await this.#attempts.execute(node, item, number)
      events.deadline({ kind: 'end' })
      tracker.end()
      attempts.push(result)
      if (result.status === 'passed' || tracker.reason || !retryable) break
    }
    return { ...base, durationMs: now() - started, attempts }
  }
}

/**
 * runを辿る一式を組み立てる。入口(ライブラリのrun・収集の実行手順)だけが呼ぶ。
 * 実行場所を渡したrunも手元で走らせる構えは備えるが、辿る間はそちらを呼ばない。
 */
export function createRunWalker(run: RunServices, comparison: Comparison, executor: Executor | null = null): RunWalker {
  // callの対象をmoduleの差し替え先へ繋ぎ直すのは実行worker側の仕事で、host側は対象をそのまま使う。
  const attempts = new AttemptExecutor(comparison, run.tracker, run.events, new CallBinder())
  return new RunWalker(
    run.results,
    run.events,
    run.tracker,
    attempts,
    new GroupMiddlewareExecutor(run.tracker, run.events),
    executor,
  )
}
