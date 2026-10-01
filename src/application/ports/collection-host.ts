import type { RuntimeBlueprint } from '../../domain/definition/runtime.js'
import type { ExecutionNode } from '../../domain/execution/model.js'
import type { Value } from '../../foundation/value.js'
import type { Config } from '../collection/config.js'
import type { CliOptions } from '../collection/options.js'
import type { Comparison } from './comparison.js'
import type { Executor } from './executor.js'
import type { ModuleInvoke, ModulePreparation, RootReference } from './module-loader.js'

/** 実行場所を基準にしたファイルの読み取り。探索・設定・表示名のどれも同じ基準に従う。 */
export interface ProjectFiles {
  resolve(file: string): string
  glob(pattern: string): string[]
  relative(file: string): string
  readConfig(options: CliOptions, onLoading: (file: string) => void): Promise<Config>
}

/** 変換したコードを配る資源。 */
export interface ModuleCompiler {
  invoke: ModuleInvoke
  close(): Promise<void>
}

/** テストファイルを読み込む資源。 */
export interface CollectionRuntime {
  import(file: string): Promise<Value>
  close(): Promise<void>
}

/**
 * test runtimeを立て、そこで読み込んだmoduleを見分ける一式。
 * prepareとdescribeは純粋な変換に見えるが、runtimeが組み立てたnamespaceの出自を知る台帳を見るため、
 * 資源を作る口と同じ持ち主でなければ噛み合わない。
 */
export interface ModuleToolchain {
  createCompiler(vite: Config['vite']): Promise<ModuleCompiler>
  createRuntime(invoke: ModuleInvoke): CollectionRuntime
  prepare(blueprints: RuntimeBlueprint[]): ModulePreparation[]
  describe(nodes: ExecutionNode[]): Value
}

/** 実行側へ渡す計画。値だけで構成する。 */
export interface ExecutionSpec {
  roots: RootReference[]
  preparation: ModulePreparation[]
  shape: string
}

/** 実行側が外とやりとりする手段。 */
export interface ExecutionServices {
  invoke: ModuleInvoke
  signal: AbortSignal
  onLoading: (file: string) => void
}

/** 収集から実行までが外部実装へ求めるもの。関心ごとにまとめ、値の設計は引数で渡す。 */
export interface CollectionHost {
  files: ProjectFiles
  modules: ModuleToolchain
  comparison: Comparison
  warn(message: string): void
  openExecution(spec: ExecutionSpec, services: ExecutionServices): Promise<Executor>
}
