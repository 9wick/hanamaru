import { Config as Contract } from '@zeltjs/core'
import type { RuntimeBlueprint } from '../../domain/definition/runtime.js'
import type { ExecutionNode } from '../../domain/execution/model.js'
import type { Value } from '../../foundation/value.js'
import type { Config } from '../collection/config.js'
import type { CliOptions } from '../collection/options.js'
import type { ModulePreparation } from './module-loader.js'

/** 実行場所を基準にしたファイルの読み取り。探索・設定・表示名のどれも同じ基準に従う。 */
@Contract({ abstract: true })
export abstract class ProjectFiles {
  abstract resolve(file: string): string
  abstract glob(pattern: string): string[]
  abstract relative(file: string): string
  abstract readConfig(options: CliOptions, onLoading: (file: string) => void): Promise<Config>
}

/**
 * test runtimeを立て、そこで読み込んだmoduleを見分ける一式。
 * prepareとdescribeは純粋な変換に見えるが、runtimeが組み立てたnamespaceの出自を知る台帳を見るため、
 * 資源を開く口と同じ持ち主でなければ噛み合わない。資源の解放はこの一式を抱えるscopeが受け持つ。
 */
@Contract({ abstract: true })
export abstract class ModuleToolchain {
  /** vite設定は設定ファイルを読むまで決まらないため、組み立て時ではなくここで受け取る。 */
  abstract start(vite: Config['vite']): Promise<void>
  abstract import(file: string): Promise<Value>
  abstract invoke(name: string, args: Value[]): Promise<Value>
  abstract prepare(blueprints: RuntimeBlueprint[]): ModulePreparation[]
  abstract describe(nodes: ExecutionNode[]): Value
}

/** 人へ向けた警告の行き先。結果表示の通り道とは分ける。 */
@Contract({ abstract: true })
export abstract class Warnings {
  abstract warn(message: string): void
}
