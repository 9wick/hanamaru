import { Config, inject } from '@zeltjs/core'
import type { Fields, RuntimeCase } from '@hanamaru/blueprint/model'
import { defaultMiddlewareTimeoutMs } from '../../domain/execution/config.js'
import type { GroupNode, Plan, SuiteNode } from '../../domain/execution/model.js'
import { required } from '../../domain/execution/javascript.js'
import type { AttemptReply, GroupReply } from '../../application/ports/executor.js'
import { AttemptExecutor } from '../../application/execution/attempt.js'
import { now } from '../../application/execution/clock.js'
import { RunLifecycle } from '../../application/execution/lifecycle.js'
import { GroupMiddlewareExecutor } from '../../application/execution/middleware.js'
import type { RootReference } from '../../application/ports/root-reference.js'
import { ExecutionLauncher } from '../../application/ports/executor.js'
import type {
  ExecutionHandle,
  ExecutionServices,
  ExecutionSpec,
  PreparedExecution,
} from '../../application/ports/executor.js'

/**
 * 手元のプロセスで走らせる持ち場。節はそのまま実行サービスへ渡せるため、pathは見ない。
 * 囲みの区間は手元で測るため、期限の知らせもここから出す。
 */
@Config()
export class LocalExecutor extends ExecutionLauncher implements PreparedExecution {
  readonly #attempts: AttemptExecutor
  readonly #groups: GroupMiddlewareExecutor
  readonly #lifecycle: RunLifecycle

  constructor(
    attempts = inject(AttemptExecutor),
    groups = inject(GroupMiddlewareExecutor),
    lifecycle = inject(RunLifecycle),
  ) {
    super()
    this.#attempts = attempts
    this.#groups = groups
    this.#lifecycle = lifecycle
  }

  open(): PreparedExecution {
    return this
  }

  start(_spec: ExecutionSpec, _services: ExecutionServices): Promise<ExecutionHandle> {
    return Promise.resolve(this)
  }

  initialize(_plan: Plan, _roots: RootReference[], _signal: AbortSignal, _timeout: number): Promise<void> {
    return Promise.resolve()
  }

  attempt(node: SuiteNode, item: RuntimeCase, _path: number[], number: number): Promise<AttemptReply> {
    return this.#attempts.execute(node, item, number)
  }

  group(node: GroupNode, path: number[], body: (fields: Fields) => Promise<void>): Promise<GroupReply> {
    const started = now()
    return this.#groups.execute(node, body, (stage) => {
      if (stage === 'inside' || stage === 'end') this.#lifecycle.deadline({ kind: 'end' })
      else {
        const timeoutMs = required(node.bp.middleware).timeout ?? defaultMiddlewareTimeoutMs
        this.#lifecycle.begin({ kind: 'group', path, stage, started, timeoutMs })
      }
    })
  }

  /** 手元の実行が開いた資源はない。 */
  close(): Promise<void> {
    return Promise.resolve()
  }
}
