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
export type { ExecutionConfig } from './domain/definition/conditions.js'
export type { AnyFn, FnKeys, MethodOf } from './domain/definition/target-types.js'
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
import { createTest } from './interfaces/library/definition.js'
import { createRegisterTest } from './interfaces/library/registration.js'
import { createBlueprintLocation } from './infrastructure/source-location.js'
import { recordDeclaration } from './application/declarations.js'
import type { Test as TestType } from './interfaces/library/types.js'

const location = createBlueprintLocation(import.meta.url)
export type Test<R extends object = {}> = TestType<R>
export const Test = createTest(location, recordDeclaration)
export const registerTest = createRegisterTest(location, recordDeclaration)
