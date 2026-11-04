export type { ContractConditions as Assertions } from './domain/assertion/compiled-checks.js'
export { environment } from './interfaces/library/environment.js'
export type { Environment, EnvironmentFn } from './interfaces/library/environment.js'
export type { State, Action, Evidence, ObservationScope, ActionSession } from './domain/definition/observation.js'
export { valueAdapter } from './domain/assertion/value-adapter.js'
export type { ValueAdapter } from './domain/assertion/value-adapter.js'
export { integers, strings, boolean, constant, arrays, tuples, record, oneOf } from './domain/definition/generation.js'
export type { Arbitrary, Generated } from './domain/definition/generation.js'
export { resource } from './interfaces/library/resource.js'
export type { CallRef, FinalStepRef } from './domain/definition/steps.js'
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
  CaseMethods,
  ChildrenPhase,
  CompatibleChildren,
  ExecutionSettings,
  Expect,
  FirstPhase,
  GroupChildren,
  GroupStage,
  GroupSuite,
  ItArgs,
  ItBuilder,
  ItDone,
  ItExpected,
  Middleware,
  Suite,
  TargetStage,
  TestBuilder,
  TestConstructor,
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

export { scenario, method } from './domain/definition/scenario.js'
export type { Scenario, Method } from './domain/definition/scenario.js'

export type { Ref } from './domain/assertion/references.js'
