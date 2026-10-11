import { Injectable, inject } from '@zeltjs/core'
import { checkedResources } from '@hanamaru/blueprint/model'
import { jsonFields } from './resource-context.js'
import type { CaseBlueprint } from '@hanamaru/blueprint/model'
import type { SuiteNode } from '../../domain/execution/model.js'
import type { MutableAttempt, MutableCaseResult, MutableTestResult } from '../../domain/result/mutable.js'
import { ExecutionLauncher } from '../ports/executor.js'
import { now } from './clock.js'
import { RunLifecycle } from './lifecycle.js'
import { RunResources } from './resources.js'
import { caseBase, executableMode, notRunCase } from './results.js'

/** ケースの未実行判断、資源の供給、試行履歴と再試行を取りまとめる。 */
@Injectable()
export class CaseExecutor {
  readonly #backend: ExecutionLauncher
  readonly #resources: RunResources
  readonly #lifecycle: RunLifecycle

  constructor(backend = inject(ExecutionLauncher), resources = inject(RunResources), lifecycle = inject(RunLifecycle)) {
    this.#backend = backend
    this.#resources = resources
    this.#lifecycle = lifecycle
  }

  async executeSuite(only: boolean, node: SuiteNode, path: number[]): Promise<MutableTestResult> {
    const cases: MutableCaseResult[] = []
    for (const [index, item] of node.bp.cases.entries()) {
      const value = await this.execute(only, node, item, index, path)
      cases.push(value)
      this.#lifecycle.publish({ kind: 'case', result: value })
    }
    return { kind: 'test', name: node.bp.name, path, cases }
  }

  async execute(
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
      const { result, retryable } = await this.#backend.attempt(prepared, item, base.path, number)
      lifecycle.deadline({ kind: 'end' })
      lifecycle.end()
      attempts.push(result)
      if (result.status === 'passed' || lifecycle.reason || !retryable) break
    }
    return { ...base, durationMs: now() - started, attempts }
  }
}
