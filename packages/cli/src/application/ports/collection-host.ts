import { Config } from '@zeltjs/core'
import type { RuntimeBlueprint } from '@hanamaru/blueprint/model'
import type { ExecutionNode } from '@hanamaru/execution/domain/execution/model'
import type { Value } from '../collection/javascript.js'
import type { Config as ProjectConfig } from '../collection/config.js'
import type { CliOptions } from '../collection/options.js'
import type { ModulePreparation } from '@hanamaru/module-runtime/application/ports/module-loader'

/** 実行場所を基準にしたファイルの読み取り。探索・設定・表示名のどれも同じ基準に従う。 */
@Config({ abstract: true })
export abstract class ProjectFiles {
  abstract resolve(file: string): string
  abstract glob(pattern: string): string[]
  abstract relative(file: string): string
  abstract readConfig(options: CliOptions, onLoading: (file: string) => void): Promise<ProjectConfig>
}

/**
 * 開いたtest runtime一式。1回の収集ぶんの持ち場で、開いた資源は畳むところまでここが受け持つ。
 * prepareとdescribeは純粋な変換に見えるが、runtimeが組み立てたnamespaceの出自を知る台帳を見るため、
 * 資源を開く口と同じ持ち主でなければ噛み合わない。
 */
export interface ModuleSession {
  import(file: string): Promise<Value>
  invoke(name: string, args: Value[]): Promise<Value>
  prepare(blueprints: RuntimeBlueprint[]): ModulePreparation[]
  describe(nodes: ExecutionNode[]): Value
  close(): Promise<void>
}

/** test runtimeを立てる口。vite設定は設定ファイルを読むまで決まらないため、組み立て時ではなくここで受け取る。 */
@Config({ abstract: true })
export abstract class ModuleToolchain {
  abstract open(vite: ProjectConfig['vite']): Promise<ModuleSession>
}

/** 人へ向けた警告の行き先。結果表示の通り道とは分ける。 */
@Config({ abstract: true })
export abstract class Warnings {
  abstract warn(message: string): void
}
