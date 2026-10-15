import { Injectable } from '@zeltjs/core'
import type { Resource } from '@hanamaru/blueprint/model'
import { resourceGraph } from '@hanamaru/blueprint/model'
import type { ExecutionNode } from '../../domain/execution/model.js'

/** 実行するケースの要求から依存先を含む資源全体と準備順を確定する。 */
@Injectable()
export class ResourcePlanner {
  plan(nodes: ExecutionNode[], only: boolean): Resource[] {
    const roots: Resource[] = []
    const visit = (items: ExecutionNode[]): void => {
      for (const node of items) {
        if (node.kind === 'group') visit(node.children)
        else
          for (const item of node.bp.cases)
            if (item.mode !== 'skip' && item.mode !== 'todo' && (!only || item.mode === 'only'))
              roots.push(...(node.resources ?? []), ...(item.resources ?? []))
      }
    }
    visit(nodes)
    return resourceGraph(roots)
  }
}
