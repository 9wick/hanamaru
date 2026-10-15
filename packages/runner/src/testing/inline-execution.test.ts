import { defaultMiddlewareTimeoutMs } from '../../../execution/src/domain/execution/config.js'
import { Config, inject, Injectable } from '@zeltjs/core'
import {
  completedDefinitions,
  validatedBlueprints,
  type Fields,
  type RuntimeCase,
  type TestDefinition,
} from '@hanamaru/blueprint/model'
import { AttemptExecutor } from '../../../execution/src/application/execution/attempt.js'
import { GroupMiddlewareExecutor } from '../../../execution/src/application/execution/middleware.js'
import { ExecutionLifecycle } from '../../../execution/src/application/execution/lifecycle.js'
import { CaseFailed as WorkerCaseFailed } from '../../../execution/src/application/execution/faults.js'
export { ValueComparison } from '../../../execution/src/infrastructure/comparison.js'
import { CaseFailed } from '../application/execution/faults.js'
import { ExecutionLauncher, type AttemptReply, type GroupReply } from '../application/ports/executor.js'
import { RunLifecycle } from '../application/execution/lifecycle.js'
import { RunContext } from '../application/execution/context.js'
import { RunTests } from '../application/usecases/run-tests.js'
import type { GroupNode, SuiteNode } from '../domain/execution/model.js'
import type { Deadline, Progress } from '../application/execution/state.js'
import type { RunSettings } from '../application/execution/options.js'
import type { MutableRunResult } from '../domain/result/mutable.js'
import type { RunResult } from '../domain/result/types.js'
import { finalizeRun } from '../domain/result/finalize.js'

export interface RunInput extends RunSettings {
  readonly onProgress?: (progress: Progress) => void
  readonly onDeadline?: (deadline: Deadline) => void
  readonly onTimeout?: (result: MutableRunResult) => void
  readonly signal?: AbortSignal
}
export function collectBlueprints(input: unknown) {
  return validatedBlueprints(completedDefinitions(input))
}

/** unitでだけ使う接続。別realmで渡す失敗も同じprotocol上の意味に翻訳する。 */
@Config()
export class LocalExecutor extends ExecutionLauncher {
  readonly #attempts: AttemptExecutor
  readonly #groups: GroupMiddlewareExecutor
  readonly #worker: ExecutionLifecycle
  readonly #lifecycle: RunLifecycle
  readonly #context: RunContext
  #run: object | null = null
  #signal: AbortSignal | undefined
  readonly #interrupt = () => this.#worker.interrupt()
  constructor(
    attempts = inject(AttemptExecutor),
    groups = inject(GroupMiddlewareExecutor),
    worker = inject(ExecutionLifecycle),
    lifecycle = inject(RunLifecycle),
    context = inject(RunContext),
  ) {
    super()
    this.#attempts = attempts
    this.#groups = groups
    this.#worker = worker
    this.#lifecycle = lifecycle
    this.#context = context
    worker.observe((event) => {
      if (event.phase) lifecycle.markPhase(event.phase)
      lifecycle.timedOut()
    })
  }
  #reset(): void {
    if (this.#run !== this.#context.data) {
      this.#run = this.#context.data
      this.#worker.reset()
    }
  }
  open() {
    return this
  }
  async start() {
    return this
  }
  async initialize(
    _plan: import('../domain/execution/model.js').Plan,
    _roots: import('../application/ports/root-reference.js').RootReference[],
    signal: AbortSignal,
  ): Promise<void> {
    this.#reset()
    this.#signal = signal
    signal.addEventListener('abort', this.#interrupt)
    if (signal.aborted) this.#interrupt()
  }
  async attempt(node: SuiteNode, item: RuntimeCase, _path: number[], number: number): Promise<AttemptReply> {
    this.#reset()
    try {
      const reply = { ...(await this.#attempts.execute(node, item, number)), reason: this.#worker.reason }
      if (reply.reason) this.#lifecycle.abort(reply.reason)
      return reply
    } finally {
      this.#worker.end()
    }
  }
  async group(node: GroupNode, path: number[], body: (fields: Fields) => Promise<void>): Promise<GroupReply> {
    this.#reset()
    this.#worker.markPhase('middleware')
    const started = performance.now()
    try {
      return await this.#groups.execute(
        node,
        async (fields) => {
          try {
            await body(fields)
          } catch (error) {
            if (error instanceof CaseFailed) throw new WorkerCaseFailed()
            throw error
          }
        },
        (stage) => {
          if (stage === 'inside' || stage === 'end') this.#lifecycle.deadline({ kind: 'end' })
          else
            this.#lifecycle.begin({
              kind: 'group',
              path,
              stage,
              started,
              timeoutMs: node.bp.middleware?.timeout ?? defaultMiddlewareTimeoutMs,
            })
        },
      )
    } finally {
      this.#worker.end()
    }
  }
  async close(): Promise<void> {
    this.#signal?.removeEventListener('abort', this.#interrupt)
    this.#signal = undefined
  }
}

@Injectable()
export class InlineRunHarness {
  readonly #lifecycle: RunLifecycle
  readonly #tests: RunTests
  constructor(lifecycle = inject(RunLifecycle), tests = inject(RunTests)) {
    this.#lifecycle = lifecycle
    this.#tests = tests
  }
  async run(input: TestDefinition | readonly TestDefinition[], options: RunInput = {}): Promise<RunResult> {
    const stop = this.#lifecycle.observe((event) => {
      if (event.kind === 'progress') options.onProgress?.(event.progress)
      else if (event.kind === 'deadline') options.onDeadline?.(event.deadline)
      else if (event.kind === 'timeout') options.onTimeout?.(this.#lifecycle.capture('timeout'))
    })
    try {
      return finalizeRun(
        await this.#tests.executeBlueprints(collectBlueprints(input), options, options.signal, {
          roots: [],
          timeout: 30000,
        }),
      )
    } finally {
      stop()
    }
  }
}
