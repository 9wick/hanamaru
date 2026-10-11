import { Injectable, inject } from '@zeltjs/core'
import type { Plan } from '../../domain/execution/model.js'
import type { MutableNodeResult, MutableRunResult } from '../../domain/result/mutable.js'
import { ExecutionLauncher } from '../ports/executor.js'
import { CaseExecutor } from './case.js'
import { GroupExecutor } from './group.js'
import { RunLifecycle } from './lifecycle.js'
import type { RunSettings } from './options.js'
import { RunResources } from './resources.js'
import { cancelledTree, resultFailed } from './results.js'

/** 計画に沿って資源を準備し、グループとケースを実行し、解放後の全体結果を返す。 */
@Injectable()
export class PlanExecutor {
  readonly #groups: GroupExecutor
  readonly #cases: CaseExecutor
  readonly #resources: RunResources
  readonly #lifecycle: RunLifecycle
  readonly #backend: ExecutionLauncher

  constructor(
    groups = inject(GroupExecutor),
    cases = inject(CaseExecutor),
    resources = inject(RunResources),
    lifecycle = inject(RunLifecycle),
    backend = inject(ExecutionLauncher),
  ) {
    this.#groups = groups
    this.#cases = cases
    this.#resources = resources
    this.#lifecycle = lifecycle
    this.#backend = backend
  }

  async execute(plan: Plan, settings: RunSettings, signal?: AbortSignal): Promise<MutableRunResult> {
    const { nodes, only, resources: graph = [] } = plan
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
            : await (node.kind === 'group'
                ? this.#groups.execute(only, node, [node.originalIndex ?? index])
                : this.#cases.executeSuite(only, node, [node.originalIndex ?? index])),
        )
    } finally {
      try {
        try {
          await this.#backend.close()
        } finally {
          await resources.close()
        }
      } finally {
        signal?.removeEventListener('abort', interrupt)
      }
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
}
