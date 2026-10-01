import { Injectable, inject } from '@zeltjs/core'
import { AttemptExecutor } from '../../application/execution/attempt.js'
import { failChildren, GroupMiddlewareExecutor } from '../../application/execution/middleware.js'
import { RunTracker } from '../../application/execution/services.js'
import type { Fields } from '../../domain/definition/runtime.js'
import type { ExecutionNode, Frame } from '../../domain/execution/model.js'
import { required } from '../../foundation/value.js'
import { ModuleRuntime } from '../modules/runtime.js'
import { CommandQueue } from './execution-session.js'
import { ExecutionChannel } from './execution-channel.js'
import type { ExecutionCommand } from './protocol.js'

/** 囲んでいる最中のgroup。開いた順に積み、閉じるまで子のframeとfieldsに効く。 */
interface ActiveGroup {
  path: number[]
  frameCount: number
  fields: Fields
}

/** 囲んでいるgroupのframeとfieldsを、節が持つ並びへ織り込む。 */
function withGroups<N extends ExecutionNode>(node: N, groups: ActiveGroup[]): N {
  const frames: Frame[] = []
  const stable: Fields = {}
  for (const group of groups) Object.assign(stable, group.fields)
  node.frames.forEach((frame, index) => {
    frames.push(frame)
    for (const group of groups) if (group.frameCount === index + 1) frames.push({ steps: [], fields: group.fields })
  })
  return { ...node, frames, stable }
}

/**
 * 親から届くcommandを1件ずつ処理する実行worker側の受け口。
 * group-openは、閉じるまでの間だけ入れ子でcommandを受け続ける。この入れ子が囲みの寿命そのものになる。
 */
@Injectable()
export class ExecutionServer {
  readonly #commands: CommandQueue
  readonly #tracker: RunTracker
  readonly #attempts: AttemptExecutor
  readonly #groupMiddleware: GroupMiddlewareExecutor
  readonly #runtime: ModuleRuntime
  readonly #channel: ExecutionChannel

  constructor(
    commands = inject(CommandQueue),
    tracker = inject(RunTracker),
    attempts = inject(AttemptExecutor),
    groupMiddleware = inject(GroupMiddlewareExecutor),
    runtime = inject(ModuleRuntime),
    channel = inject(ExecutionChannel),
  ) {
    this.#commands = commands
    this.#tracker = tracker
    this.#attempts = attempts
    this.#groupMiddleware = groupMiddleware
    this.#runtime = runtime
    this.#channel = channel
  }

  /** 親が口を閉じるまで戻らない。 */
  async serve(nodes: Map<string, ExecutionNode>): Promise<void> {
    await this.#serve(nodes, [])
  }

  async #serve(
    nodes: Map<string, ExecutionNode>,
    groups: ActiveGroup[],
  ): Promise<Extract<ExecutionCommand, { type: 'group-close' }>> {
    while (true) {
      const command = await this.#commands.take()
      if (command.type === 'group-close') {
        if (!groups.length || JSON.stringify(command.path) !== JSON.stringify(required(groups.at(-1)).path))
          throw new TypeError('group close does not match the active group')
        return command
      }
      const key = JSON.stringify(command.type === 'attempt' ? command.path.slice(0, -1) : command.path)
      const original = nodes.get(key)
      if (!original) throw new TypeError('execution job references an unknown path')
      const node = this.#runtime.bindNode(withGroups(original, groups))
      if (command.type === 'attempt') {
        if (node.kind !== 'test') throw new TypeError('attempt requires a test node')
        const item = node.bp.cases[required(command.path.at(-1))]
        if (
          !item ||
          item.mode === 'skip' ||
          item.mode === 'todo' ||
          !Number.isSafeInteger(command.number) ||
          command.number < 1
        )
          throw new TypeError('invalid attempt job')
        this.#tracker.markPhase('middleware')
        const result = await this.#attempts.execute(node, this.#runtime.bindCase(item), command.number)
        this.#tracker.end()
        this.#channel.reply(command.id, { ...result, reason: this.#tracker.reason })
      } else if (command.type === 'group-open') {
        if (node.kind !== 'group' || !node.bp.middleware) throw new TypeError('invalid group job')
        const closeState: { command?: Extract<ExecutionCommand, { type: 'group-close' }> } = {}
        const result = await this.#groupMiddleware.execute(
          node,
          async (fields) => {
            this.#channel.reply(command.id, { entered: true })
            closeState.command = await this.#serve(nodes, [
              ...groups,
              { path: command.path, frameCount: node.frameCount, fields },
            ])
            if (closeState.command.failed) failChildren()
          },
          (stage, timeoutMs) => this.#channel.groupStage(command.path, stage, timeoutMs),
        )
        this.#channel.reply(closeState.command ? closeState.command.id : command.id, { ...result, entered: false })
      } else throw new TypeError('unknown execution command')
    }
  }
}
