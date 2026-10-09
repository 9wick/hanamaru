import { createApp } from '@zeltjs/core'
import { onNode } from '@zeltjs/adapter-node'
import type { RunOptions } from './application/execution/options.js'
import type { TestDefinition } from './domain/definition/types.js'
import type { RunResult } from './domain/result/types.js'
import { LocalExecutor } from './infrastructure/execution/local.js'
import { ValueComparison } from './infrastructure/comparison.js'
import { LibraryFeature } from './interfaces/library/run-feature.js'

// このモジュールは最初のrunで読み込む。Appの構成と比較実装は以後のrunでも共有する。
const app = createApp([new LibraryFeature()], { configs: [ValueComparison, LocalExecutor] })
const nodeApp = await onNode(app)

export function run(input: TestDefinition | readonly TestDefinition[], options: RunOptions = {}): Promise<RunResult> {
  return nodeApp.library.run(input, options)
}
