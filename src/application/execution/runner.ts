import { checkedResources, jsonFields } from '../../domain/definition/resource.js'
import { RunResources } from './resources.js'
import type { CaseBlueprint, Fields, RuntimeCase } from '../../domain/definition/runtime.js'
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
import type { AttemptReply, ExecutionHandle, GroupReply } from '../ports/executor.js'
import { now } from './clock.js'
import { CaseFailed } from './faults.js'
import { allCases } from './plan.js'
import { caseBase, cancelledTree, executableMode, notRunCase, notRunMiddleware, resultFailed } from './results.js'
import type { RunSettings } from './options.js'
import { RunLifecycle } from './lifecycle.js'

/**
 * 計画走査の共通手順。ローカル実行とworker実行が、それぞれ自分のattempt/groupを使って辿る。
 * 進捗・中断と資源の管理はconstructorの依存、計画・設定・中断の合図はrunの引数に置く。
 */
export abstract class RunWalker implements ExecutionHandle {
  readonly #resources: RunResources
  readonly #lifecycle: RunLifecycle

  protected constructor(resources: RunResources, lifecycle: RunLifecycle) {
    this.#resources = resources
    this.#lifecycle = lifecycle
  }

  protected abstract attempt(node: SuiteNode, item: RuntimeCase, path: number[], number: number): Promise<AttemptReply>
  protected abstract group(
    node: GroupNode,
    path: number[],
    body: (fields: Fields) => Promise<void>,
  ): Promise<GroupReply>
  abstract close(): Promise<void>

  /** 重なりの錠は入口が持つ。この走査が始まる時点で錠は取られている。 */
  async run(buildPlan: () => Plan, settings: RunSettings, signal?: AbortSignal): Promise<MutableRunResult> {
    const { nodes, only, resources: graph = [] } = buildPlan()
    const resources = this.#resources
    const lifecycle = this.#lifecycle
    // 走り出す前に中断されていた実行は、1件も動かさずに打ち切った姿で返す。
    if (signal?.aborted) lifecycle.interrupt()
    // 実行前の結果は、全てを実行しなかった姿。ここから完了したものだけを差し替えていく。
    this.#lifecycle.publish({
      kind: 'init',
      result: {
        version: 1,
        status: 'cancelled',
        reason: 'interrupted',
        tests: nodes.map((node, index) => cancelledTree(node, [node.originalIndex ?? index], only)),
      },
    })
    const interrupt = () => lifecycle.interrupt()
    signal?.addEventListener('abort', interrupt)
    const tests: MutableNodeResult[] = []
    try {
      await resources.prepare(graph, signal)
      for (const [index, node] of nodes.entries())
        tests.push(
          lifecycle.reason
            ? cancelledTree(node, [node.originalIndex ?? index], only)
            : await this.#node(only, node, [node.originalIndex ?? index]),
        )
    } finally {
      try {
        await this.close()
      } finally {
        await resources.close()
      }
      signal?.removeEventListener('abort', interrupt)
    }
    const failed =
      resultFailed(tests, settings.failOnFlaky) ||
      resources.results.some((r) => r.middleware.status === 'failed') ||
      lifecycle.reason === 'timeout' ||
      lifecycle.reason === 'cleanup-failed'
    return {
      version: 1,
      status: failed ? 'failed' : lifecycle.reason === 'interrupted' ? 'cancelled' : 'passed',
      reason: lifecycle.reason ?? 'completed',
      tests,
      ...(resources.results.length ? { resources: resources.results } : {}),
    }
  }

  async #node(only: boolean, node: ExecutionNode, path: number[]): Promise<MutableNodeResult> {
    // testの中身はcaseごとに通知済みなので、節として追加で知らせるのはgroupのmiddlewareだけ。
    if (node.kind === 'test') return this.#test(only, node, path)
    const value = await this.#group(only, node, path)
    this.#lifecycle.publish({ kind: 'group', path, middleware: value.middleware })
    return value
  }

  async #test(only: boolean, node: SuiteNode, path: number[]): Promise<MutableTestResult> {
    const cases: MutableCaseResult[] = []
    for (const [index, item] of node.bp.cases.entries()) {
      const value = await this.#case(only, node, item, index, path)
      cases.push(value)
      this.#lifecycle.publish({ kind: 'case', result: value })
    }
    return { kind: 'test', name: node.bp.name, path, cases }
  }

  async #group(only: boolean, node: GroupNode, path: number[]): Promise<MutableGroupResult> {
    const lifecycle = this.#lifecycle
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
          result: lifecycle.reason
            ? cancelledTree(prepared, childPath(child, index), only)
            : await this.#node(only, prepared, childPath(child, index)),
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
    if (!node.bp.middleware || lifecycle.reason) {
      const middleware = node.bp.middleware ? notRunMiddleware('cancelled') : null
      try {
        await executeChildren({})
      } catch (error) {
        if (!(error instanceof CaseFailed)) throw error
      }
      return group(middleware)
    }
    const supplied = this.#resources.fields(node.resources)
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
    const reply = await this.group(prepared, path, executeChildren)
    if (reply.reason) lifecycle.abort(reply.reason)
    // middlewareが落ちた時点で残りの子は動かないため、実行しなかった姿で埋める。
    if (reply.middleware.status === 'failed')
      for (let index = children.length; index < node.children.length; index++) {
        const child = node.children[index]
        children.push({
          origin: required(child.entryOrigin),
          result: cancelledTree(child, childPath(child, index), only),
        })
      }
    lifecycle.end()
    return group(reply.middleware)
  }

  async #case(
    only: boolean,
    node: SuiteNode,
    item: CaseBlueprint,
    index: number,
    path: number[],
  ): Promise<MutableCaseResult> {
    const lifecycle = this.#lifecycle
    const base = caseBase(node.config, item, index, path)
    const mode = executableMode(item, only)
    // todoを先に外すことで、以降のitemが実行に必要な定義を備えたcaseだと型でも決まる。
    if (item.mode === 'todo' || mode || lifecycle.reason) return notRunCase(base, mode ?? 'cancelled')
    const supplied = this.#resources.fields(checkedResources([...(node.resources ?? []), ...(item.resources ?? [])]))
    if (supplied === null) return notRunCase(base, 'cancelled')
    const started = now(),
      attempts: MutableAttempt[] = []
    for (let number = 1; number <= base.config.retry + 1; number++) {
      lifecycle.begin({ kind: 'attempt', base, attempts, number, started: now(), timeoutMs: base.config.timeout })
      const fields = jsonFields(supplied)
      const prepared = Object.keys(fields).length
        ? { ...node, resourceFields: fields, frames: [{ steps: [], fields }, ...node.frames] }
        : node
      const { result, retryable } = await this.attempt(prepared, item, base.path, number)
      lifecycle.deadline({ kind: 'end' })
      lifecycle.end()
      attempts.push(result)
      if (result.status === 'passed' || lifecycle.reason || !retryable) break
    }
    return { ...base, durationMs: now() - started, attempts }
  }
}
