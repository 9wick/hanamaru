export * from '@hanamaru/blueprint'

declare global {
  interface ImportMeta {
    readonly hanamaru?: Pick<
      typeof import('@hanamaru/blueprint'),
      'Test' | 'registerTest' | 'middleware' | 'resource' | 'relation'
    >
  }
}
export type { Config } from '@hanamaru/cli/application/collection/config'
export type { ResolvedExecutionConfig } from '@hanamaru/runner/domain/execution/config'
export type { TargetCatalogue, DefinitionTarget, CaseTarget } from '@hanamaru/runner/domain/execution/targets'
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
} from '@hanamaru/runner/domain/result/types'
import type { Config } from '@hanamaru/cli/application/collection/config'
export function defineConfig(config: Config): Config {
  return config
}
