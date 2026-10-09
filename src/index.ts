export { resource } from './interfaces/library/resource.js'
export { relation } from './domain/definition/relation.js'
export type { Relation } from './domain/definition/relation.js'
export type {
  CallRef,
  CallArguments,
  CallOutput,
  CallsResult,
  InvocationBuilder,
  RelationCalls,
} from './domain/definition/calls.js'
export type {
  Resource,
  ResourceScope,
  ResourceContext,
  ResourceFields,
  ResourceNext,
  JsonValue,
  JsonObject,
} from './domain/definition/resource.js'
export type { Config } from './application/collection/config.js'
export type { RunOptions } from './application/execution/options.js'
export type {
  Assertion,
  Assertions,
  CallAssertion,
  CallExpectations,
  ErasedResultAssertion,
  ErrorAssertion,
  ResultAssertion,
  ValueCheck,
} from './domain/assertion/types.js'
export type {
  BehaviorAction,
  BehaviorBlueprint,
  Ctx,
  DefinitionBlueprint,
  ErasedSuiteBlueprint,
  ExecutableCase,
  ExpectationBlueprint,
  ExtendContext,
  GroupBlueprint,
  GroupEntry,
  GroupMiddlewareBlueprint,
  MiddlewareBlueprint,
  MiddlewareFn,
  MiddlewareOptions,
  MiddlewareResult,
  MockBlueprint,
  Next,
  RowBlueprint,
  SourceLocation,
  StepBlueprint,
  SuiteBlueprint,
  TargetBlueprint,
  TestBlueprint,
  TestDefinition,
  TodoCase,
  ValueBlueprint,
} from './domain/definition/types.js'
export type { ExecutionConfig, ResolvedExecutionConfig } from './domain/execution/config.js'
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
} from './domain/result/types.js'
export type { AnyFn, FnKeys, MethodOf } from './foundation/functions.js'
export { middleware } from './interfaces/library/definition.js'
export type {
  Behavior,
  BehaviorBuilder,
  CallBuilder,
  CallMatchers,
  CallsBuilder,
  CaseMethods,
  ChildrenPhase,
  CompatibleChildren,
  ErrorAssertions,
  ExecutionSettings,
  Expect,
  FirstPhase,
  GroupChildren,
  GroupStage,
  GroupSuite,
  ItArgs,
  ItBuilder,
  ItCalls,
  ItDone,
  ItExpected,
  InvocationExpect,
  ItInvocations,
  ItInvocationChecks,
  RelationItBuilder,
  RelationSuite,
  RelationTestBuilder,
  RelationCaseMethods,
  Middleware,
  MockDef,
  Suite,
  TargetStage,
  TestBuilder,
  TestConstructor,
  ValueAssertions,
} from './interfaces/library/types.js'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Config } from './application/collection/config.js'
import { recordCollectionEvent } from './application/collection/current-scope.js'
import { createSourceLocation } from './infrastructure/source-location.js'
import { createTest } from './interfaces/library/definition.js'
import { createRegisterTest } from './interfaces/library/registration.js'
import type { RunOptions } from './application/execution/options.js'
import { runExclusively } from './application/execution/current-run.js'
import type { TestDefinition } from './domain/definition/types.js'
import type { RunResult } from './domain/result/types.js'
import type { Test as TestType } from './interfaces/library/types.js'
const location = createSourceLocation(dirname(fileURLToPath(import.meta.url)))
export type Test<R extends object = {}> = TestType<R>
export const Test = createTest(location, recordCollectionEvent)
export const registerTest = createRegisterTest(location, recordCollectionEvent)
export function run(input: TestDefinition | readonly TestDefinition[], options: RunOptions = {}): Promise<RunResult> {
  return runExclusively(async () => (await import('./library.js')).run(input, options))
}
export function defineConfig(config: Config): Config {
  return config
}
