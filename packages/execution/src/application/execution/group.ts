import { Injectable, inject } from '@zeltjs/core'
import type { Fields } from '@hanamaru/blueprint/model'
import type { ExecutionNode, GroupNode } from '../../domain/execution/model.js'
import type { MutableGroupResult, MutableNodeResult } from '../../domain/result/mutable.js'
import { required } from '../../domain/execution/javascript.js'
import { ExecutionLauncher } from '../ports/executor.js'
import { CaseExecutor } from './case.js'
import { CaseFailed } from './faults.js'
import { RunLifecycle } from './lifecycle.js'
import { RunResources } from './resources.js'
import { allCases } from './plan.js'
import { cancelledTree, executableMode, notRunMiddleware, resultFailed } from './results.js'

/** 共通の囲みを一度実行し、その範囲で子グループとケースを順に進める。 */
@Injectable()
export class GroupExecutor {
  readonly #cases: CaseExecutor
  readonly #backend: ExecutionLauncher
  readonly #resources: RunResources
  readonly #lifecycle: RunLifecycle

  constructor(
    cases = inject(CaseExecutor),
    backend = inject(ExecutionLauncher),
    resources = inject(RunResources),
    lifecycle = inject(RunLifecycle),
  ) {
    this.#cases = cases
    this.#backend = backend
    this.#resources = resources
    this.#lifecycle = lifecycle
  }

  async execute(only: boolean, node: GroupNode, path: number[]): Promise<MutableGroupResult> {
    const result = await this.#execute(only, node, path)
    this.#lifecycle.publish({ kind: 'group', path, middleware: result.middleware })
    return result
  }

  #child(only: boolean, node: ExecutionNode, path: number[]): Promise<MutableNodeResult> {
    return node.kind === 'test' ? this.#cases.executeSuite(only, node, path) : this.execute(only, node, path)
  }

  async #execute(only: boolean, node: GroupNode, path: number[]): Promise<MutableGroupResult> {
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
            : await this.#child(only, prepared, childPath(child, index)),
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
    const reply = await this.#backend.group(prepared, path, executeChildren)
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
}
