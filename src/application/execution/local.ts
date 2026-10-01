import { Config, inject } from '@zeltjs/core'
import type { Fields, RuntimeCase } from '../../domain/definition/runtime.js'
import { defaultMiddlewareTimeoutMs } from '../../domain/execution/config.js'
import type { GroupNode, SuiteNode } from '../../domain/execution/model.js'
import { required } from '../../foundation/value.js'
import type { AttemptReply, ExecutionHandle, GroupReply } from '../ports/executor.js'
import { Executor } from '../ports/executor.js'
import { AttemptExecutor } from './attempt.js'
import { now } from './clock.js'
import { GroupMiddlewareExecutor } from './middleware.js'
import { RunEvents, RunTracker } from './services.js'

/**
 * 手元のプロセスで走らせる持ち場。節はそのまま実行サービスへ渡せるため、pathは見ない。
 * 囲みの区間は手元で測るため、期限の知らせもここから出す。
 */
class LocalExecution implements ExecutionHandle {
  readonly #attempts: AttemptExecutor
  readonly #groups: GroupMiddlewareExecutor
  readonly #tracker: RunTracker
  readonly #events: RunEvents

  constructor(attempts: AttemptExecutor, groups: GroupMiddlewareExecutor, tracker: RunTracker, events: RunEvents) {
    this.#attempts = attempts
    this.#groups = groups
    this.#tracker = tracker
    this.#events = events
  }

  attempt(node: SuiteNode, item: RuntimeCase, _path: number[], number: number): Promise<AttemptReply> {
    return this.#attempts.execute(node, item, number)
  }

  group(node: GroupNode, path: number[], body: (fields: Fields) => Promise<void>): Promise<GroupReply> {
    const started = now()
    return this.#groups.execute(node, body, (stage) => {
      if (stage === 'inside' || stage === 'end') this.#events.deadline({ kind: 'end' })
      else {
        const timeoutMs = required(node.bp.middleware).timeout ?? defaultMiddlewareTimeoutMs
        this.#tracker.begin({ kind: 'group', path, stage, started, timeoutMs })
        this.#events.deadline({ kind: 'start', timeoutMs, progress: this.#tracker.activeProgress('timeout') })
      }
    })
  }

  /** 手元の実行が開いた資源はない。test runtimeの解放はこの一式を抱えるscopeが受け持つ。 */
  close(): Promise<void> {
    return Promise.resolve()
  }
}

/** 手元のプロセスで走らせる実行。ライブラリのrunがこれを選ぶ。 */
@Config()
export class LocalExecutor extends Executor {
  readonly #attempts: AttemptExecutor
  readonly #groups: GroupMiddlewareExecutor
  readonly #tracker: RunTracker
  readonly #events: RunEvents

  constructor(
    attempts = inject(AttemptExecutor),
    groups = inject(GroupMiddlewareExecutor),
    tracker = inject(RunTracker),
    events = inject(RunEvents),
  ) {
    super()
    this.#attempts = attempts
    this.#groups = groups
    this.#tracker = tracker
    this.#events = events
  }

  /** 走らせる計画も外との繋ぎも、手元の実行には要らない。読み込んだ節がそのまま対象になる。 */
  start(): Promise<ExecutionHandle> {
    return Promise.resolve(new LocalExecution(this.#attempts, this.#groups, this.#tracker, this.#events))
  }
}
