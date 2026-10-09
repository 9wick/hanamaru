import { Injectable, inject } from '@zeltjs/core'
import type { Fields, RuntimeCase } from '../../domain/definition/runtime.js'
import { defaultMiddlewareTimeoutMs } from '../../domain/execution/config.js'
import type { GroupNode, SuiteNode } from '../../domain/execution/model.js'
import { required } from '../../foundation/value.js'
import type { AttemptReply, GroupReply } from '../ports/executor.js'
import { AttemptExecutor } from './attempt.js'
import { now } from './clock.js'
import { RunLifecycle } from './lifecycle.js'
import { GroupMiddlewareExecutor } from './middleware.js'
import { RunResources } from './resources.js'
import { RunWalker } from './runner.js'

/**
 * 手元のプロセスで走らせる持ち場。節はそのまま実行サービスへ渡せるため、pathは見ない。
 * 囲みの区間は手元で測るため、期限の知らせもここから出す。
 */
@Injectable()
export class LocalExecutor extends RunWalker {
  readonly #attempts: AttemptExecutor
  readonly #groups: GroupMiddlewareExecutor
  readonly #lifecycle: RunLifecycle

  constructor(
    attempts = inject(AttemptExecutor),
    groups = inject(GroupMiddlewareExecutor),
    lifecycle = inject(RunLifecycle),
    resources = inject(RunResources),
  ) {
    super(resources, lifecycle)
    this.#attempts = attempts
    this.#groups = groups
    this.#lifecycle = lifecycle
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
