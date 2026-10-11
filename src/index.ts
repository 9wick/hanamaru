export * from '@hanamaru/blueprint'
export type { Config } from '@hanamaru/cli/application/collection/config'
export type { RunOptions } from '@hanamaru/execution/application/execution/options'
export type { ResolvedExecutionConfig } from '@hanamaru/execution/domain/execution/config'
export type {
  AssertionReference,
  AssertionResult,
  AttemptResult,
  CancelledAttemptResult,
  CaseResult,
  DiagnosticKey,
  DiagnosticProperty,
  DiagnosticValue,
  ExecutionPhase,
  FailedAttemptResult,
  Failure,
  GroupMiddlewareFailure,
  GroupMiddlewareResult,
  GroupResult,
  MiddlewareStage,
  PassedAttemptResult,
  RunResult,
  ResourceResult,
  TargetOutcome,
  TestResult,
} from '@hanamaru/execution/domain/result/types'
import type { Config } from '@hanamaru/cli/application/collection/config'
import type { RunOptions } from '@hanamaru/execution/application/execution/options'
import type { TestDefinition } from '@hanamaru/blueprint'
import type { RunResult } from '@hanamaru/execution/domain/result/types'
import { runExclusively } from '@hanamaru/execution/application/execution/current-run'

export function run(input: TestDefinition | readonly TestDefinition[], options: RunOptions = {}): Promise<RunResult> {
  return runExclusively(async () => (await import('./library.js')).run(input, options))
}
export function defineConfig(config: Config): Config {
  return config
}
