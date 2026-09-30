import type { RuntimeBlueprint } from '../../domain/definition/runtime.js'
import type { ExecutionNode } from '../../domain/execution/model.js'
import type { Value } from '../../foundation/value.js'
import type { Config } from '../collection/config.js'
import type { CliOptions } from '../collection/options.js'
import type { Comparison } from './comparison.js'
import type { Executor } from './executor.js'
import type { ModuleInvoke, ModulePreparation, RootReference } from './module-loader.js'
export interface FileDiscovery {
  resolve(file: string): string
  glob(pattern: string): string[]
}
export interface ModuleCompiler {
  invoke: ModuleInvoke
  close(): Promise<void>
}
export interface CollectionRuntime {
  import(file: string): Promise<Value>
  close(): Promise<void>
}
export interface CollectionHost extends FileDiscovery {
  comparison: Comparison
  relative(file: string): string
  warn(message: string): void
  readConfig(options: CliOptions, onLoading: (file: string) => void): Promise<Config>
  createCompiler(vite: Config['vite']): Promise<ModuleCompiler>
  createRuntime(invoke: ModuleInvoke): CollectionRuntime
  prepare(blueprints: RuntimeBlueprint[]): ModulePreparation[]
  describe(nodes: ExecutionNode[]): Value
  openExecution(options: {
    roots: RootReference[]
    preparation: ModulePreparation[]
    shape: string
    invoke: ModuleInvoke
    signal: AbortSignal
    onLoading: (file: string) => void
  }): Promise<Executor>
}
