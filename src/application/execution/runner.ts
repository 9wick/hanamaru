import { checkedResources, jsonFields } from '../../domain/definition/resource.js'
import { RunResources } from './resources.js'
import { Injectable, inject } from '@zeltjs/core'
import type { CaseBlueprint, Fields } from '../../domain/definition/runtime.js'
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
import type { ExecutionHandle } from '../ports/executor.js'
import { now } from './clock.js'
import { CaseFailed } from './faults.js'
import { allCases } from './plan.js'
import { ProgressStore } from './progress.js'
import { caseBase, cancelledTree, executableMode, notRunCase, notRunMiddleware, resultFailed } from './results.js'
import type { RunSettings } from './options.js'
import { RunEvents, RunTracker } from './services.js'
import type { Progress } from './state.js'

/** 1回のrunを辿る間ずっと同じ相手。実行の持ち場・通知の受け取り手・onlyの有無は走り出す前に決まる。 */
interface Walk {
  execution: ExecutionHandle
  events: RunEvents
  only: boolean
  resources: RunResources
}

/**
 * 計画を辿って1回のrunを進める。
 * 実行の持ち場・何を辿るか・設定・通知の受け取り手・中断の合図は実行ごとに決まるため、引数で受け取る。
 */
@Injectable()
export class RunWalker {
  readonly #results: ProgressStore
  readonly #tracker: RunTracker

  constructor(results = inject(ProgressStore), tracker = inject(RunTracker)) {
    this.#results = results
    this.#tracker = tracker
  }

  /**
   * 確定した結果は、手元の部分結果ツリーと外向きの通知の両方に同じprogressで渡す。
   * 打ち切り時の結果は受け取り手がprogressから組み立てた木と一致していなければならないため、片方だけを更新しない。
   */
  #publish(walk: Walk, progress: Progress): void {
    this.#results.apply(progress)
    walk.events.progress(progress)
  }

  /** 重なりの錠は入口が持つ。この走査が始まる時点で錠は取られている。 */
  async run(
    execution: ExecutionHandle,
    buildPlan: () => Plan,
    settings: RunSettings,
    events: RunEvents,
    signal?: AbortSignal,
  ): Promise<MutableRunResult> {
    const { nodes, only, resources: graph = [] } = buildPlan()
    const resources = new RunResources(graph, this.#tracker, events, (progress) => this.#publish(walk, progress))
    const walk: Walk = { execution, events, only, resources }
    const tracker = this.#tracker
    // 走り出す前に中断されていた実行は、1件も動かさずに打ち切った姿で返す。
    if (signal?.aborted) tracker.interrupt()
    // 実行前の結果は、全てを実行しなかった姿。ここから完了したものだけを差し替えていく。
    this.#publish(walk, {
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
      await resources.prepare(signal)
      for (const [index, node] of nodes.entries())
        tests.push(
          tracker.reason
            ? cancelledTree(node, [node.originalIndex ?? index], only)
            : await this.#node(walk, node, [node.originalIndex ?? index]),
        )
    } finally {
      try {
        await execution.close()
      } finally {
        await resources.close()
      }
      signal?.removeEventListener('abort', interrupt)
    }
    const failed =
      resultFailed(tests, settings.failOnFlaky) ||
      resources.results.some((r) => r.middleware.status === 'failed') ||
      tracker.reason === 'timeout' ||
      tracker.reason === 'cleanup-failed'
    return {
      version: 1,
      status: failed ? 'failed' : tracker.reason === 'interrupted' ? 'cancelled' : 'passed',
      reason: tracker.reason ?? 'completed',
      tests,
      ...(resources.results.length ? { resources: resources.results } : {}),
    }
  }

  async #node(walk: Walk, node: ExecutionNode, path: number[]): Promise<MutableNodeResult> {
    // testの中身はcaseごとに通知済みなので、節として追加で知らせるのはgroupのmiddlewareだけ。
    if (node.kind === 'test') return this.#test(walk, node, path)
    const value = await this.#group(walk, node, path)
    this.#publish(walk, { kind: 'group', path, middleware: value.middleware })
    return value
  }

  async #test(walk: Walk, node: SuiteNode, path: number[]): Promise<MutableTestResult> {
    const cases: MutableCaseResult[] = []
    for (const [index, item] of node.bp.cases.entries()) {
      const value = await this.#case(walk, node, item, index, path)
      cases.push(value)
      this.#publish(walk, { kind: 'case', result: value })
    }
    return { kind: 'test', name: node.bp.name, path, cases }
  }

  async #group(walk: Walk, node: GroupNode, path: number[]): Promise<MutableGroupResult> {
    const { execution, only } = walk
    const tracker = this.#tracker
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
            : await this.#node(walk, prepared, childPath(child, index)),
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
    const supplied = walk.resources.fields(node.resources)
    if (supplied === null) {
      for (const [index, child] of node.children.entries())
        children.push({
          origin: required(child.entryOrigin),
          result: cancelledTree(child, childPath(child, index), only),
        })
      return group(notRunMiddleware('cancelled'))
    }
    const prepared = {
      ...node,
      resourceFields: supplied,
      stable: { ...supplied, ...node.stable },
      frames: [{ steps: [], fields: supplied }, ...node.frames],
    }
    const reply = await execution.group(prepared, path, executeChildren)
    if (reply.reason) tracker.abort(reply.reason)
    // middlewareが落ちた時点で残りの子は動かないため、実行しなかった姿で埋める。
    if (reply.middleware.status === 'failed')
      for (let index = children.length; index < node.children.length; index++) {
        const child = node.children[index]
        children.push({
          origin: required(child.entryOrigin),
          result: cancelledTree(child, childPath(child, index), only),
        })
      }
    tracker.end()
    return group(reply.middleware)
  }

  async #case(
    walk: Walk,
    node: SuiteNode,
    item: CaseBlueprint,
    index: number,
    path: number[],
  ): Promise<MutableCaseResult> {
    const { execution, events, only } = walk
    const tracker = this.#tracker
    const base = caseBase(node.config, item, index, path)
    const mode = executableMode(item, only)
    // todoを先に外すことで、以降のitemが実行に必要な定義を備えたcaseだと型でも決まる。
    if (item.mode === 'todo' || mode || tracker.reason) return notRunCase(base, mode ?? 'cancelled')
    const supplied = walk.resources.fields(checkedResources([...(node.resources ?? []), ...(item.resources ?? [])]))
    if (supplied === null) return notRunCase(base, 'cancelled')
    const started = now(),
      attempts: MutableAttempt[] = []
    for (let number = 1; number <= base.config.retry + 1; number++) {
      tracker.begin({ kind: 'attempt', base, attempts, number, started: now(), timeoutMs: base.config.timeout })
      // 走り出す前に、いま中断されたらどう見えるかを知らせる。確定した結果ではないので手元には残さない。
      events.progress(tracker.activeProgress('interrupted'))
      events.deadline({ kind: 'start', timeoutMs: base.config.timeout, progress: tracker.activeProgress('timeout') })
      const fields = jsonFields(supplied)
      const prepared = Object.keys(fields).length
        ? { ...node, resourceFields: fields, frames: [{ steps: [], fields }, ...node.frames] }
        : node
      const { result, retryable } = await execution.attempt(prepared, item, base.path, number)
      events.deadline({ kind: 'end' })
      tracker.end()
      attempts.push(result)
      if (result.status === 'passed' || tracker.reason || !retryable) break
    }
    return { ...base, durationMs: now() - started, attempts }
  }
}
