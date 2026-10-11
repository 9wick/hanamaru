import { createApp } from '@zeltjs/core'
import { onNode } from '@zeltjs/adapter-node'
import type { RunOptions } from '@hanamaru/execution/application/execution/options'
import type { TestDefinition } from '@hanamaru/blueprint/model'
import type { RunResult } from '@hanamaru/execution/domain/result/types'
import { LocalExecutor } from '@hanamaru/execution/infrastructure/execution/local'
import { ValueComparison } from '@hanamaru/execution/infrastructure/comparison'
import { LibraryFeature } from '@hanamaru/execution/interfaces/library/run-feature'

// このモジュールは最初のrunで読み込む。Appの構成と比較実装は以後のrunでも共有する。
const app = createApp([new LibraryFeature()], { configs: [ValueComparison, LocalExecutor] })
const nodeApp = await onNode(app)

export function run(input: TestDefinition | readonly TestDefinition[], options: RunOptions = {}): Promise<RunResult> {
  return nodeApp.library.run(input, options)
}
