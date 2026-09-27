import type { Value } from './value.js'
import type {
  AnyFn,
  AssertionResult,
  BehaviorBlueprint,
  DiagnosticValue,
  ExecutionConfig,
  ExecutionPhase,
  SourceLocation,
  TargetOutcome,
  ResolvedExecutionConfig,
  RunOptions,
  Failure,
  GroupMiddlewareFailure,
} from './api.js'
import { assertionTag, behaviorTag, definitionTag, doneTag, middlewareTag, resultTag } from './shared.js'

export type Fields = Record<PropertyKey, Value>
export type RuntimeBehavior = BehaviorBlueprint & { readonly [behaviorTag]?: true }
export interface RuntimeMiddlewareResult {
  readonly [resultTag]: true
  readonly fields: Fields
}
export interface RuntimeMiddleware {
  readonly [middlewareTag]: true
  readonly kind: 'middleware'
  readonly run: object
  readonly timeout: number | undefined
}
export type ValueCheck =
  | { matcher: 'toBe' | 'toEqual' | 'toMatchObject'; expected: Value }
  | { matcher: 'toSatisfy'; predicate: object }
  | { matcher: 'toBeInstanceOf'; ctor: object }
  | { matcher: 'toThrow'; message: string | RegExp }
export type CallCheck =
  | { matcher: 'calledTimes'; count: number }
  | { matcher: 'notCalled' }
  | { matcher: 'calledWith' | 'calledOnceWith'; args: readonly Value[] }
  | { matcher: 'calledNthWith'; n: number; args: readonly Value[] }
export interface RuntimeValueAssertion {
  readonly [assertionTag]: true
  subject: 'result' | 'error'
  check: ValueCheck
}
export interface RuntimeCallAssertion {
  readonly [assertionTag]: true
  subject: 'call'
  check: CallCheck
  object: object
  key: string
  sourceObject?: object
}
export type RuntimeAssertion = RuntimeValueAssertion | RuntimeCallAssertion
export interface RuntimeMock {
  object: object
  key: string
  behavior: RuntimeBehavior
  sourceObject?: object
}
export type RuntimeTarget = { kind: 'function'; fn: AnyFn } | { kind: 'method'; object: object; key: string; fn: AnyFn }
export type RuntimeArgs = { kind: 'value'; value: Value[] } | { kind: 'from-context'; build: object }
export interface RuntimeExpectation {
  kind: 'deferred'
  build: object
}
export interface CaseData {
  readonly [doneTag]?: true
  config: ExecutionConfig
  mocks: RuntimeMock[]
  args: RuntimeArgs | null
  expect: RuntimeExpectation | null
  calls: readonly RuntimeCallAssertion[]
}
export interface CaseBase {
  name: string
  origin: SourceLocation
  row: { index: number; value: Value } | null
  config: ExecutionConfig
  originalIndex?: number
}
export interface RuntimeCase extends CaseBase {
  mode: 'run' | 'only' | 'skip'
  mocks: RuntimeMock[]
  args: RuntimeArgs
  expect: RuntimeExpectation | null
  calls: readonly RuntimeCallAssertion[]
}
export interface RuntimeTodo extends CaseBase {
  mode: 'todo'
}
export type CaseBlueprint = RuntimeCase | RuntimeTodo
export interface BlueprintBase {
  version: 1
  config: ExecutionConfig
  steps: RuntimeMiddleware[]
  mocks: RuntimeMock[]
}
export interface RuntimeSuite extends BlueprintBase {
  kind: 'test'
  name: string
  target: RuntimeTarget
  cases: CaseBlueprint[]
}
export interface RuntimeGroup extends BlueprintBase {
  kind: 'group'
  name: string | null
  origin: SourceLocation
  middleware: RuntimeMiddleware | null
  children: { origin: SourceLocation; blueprint: RuntimeBlueprint }[]
}
export interface RuntimeDefinition extends BlueprintBase {
  kind: 'definition'
  children: RuntimeGroup[]
}
export type RuntimeBlueprint = RuntimeSuite | RuntimeGroup | RuntimeDefinition
export interface RuntimeDefinitionHandle {
  readonly [definitionTag]: true
  blueprint(): RuntimeBlueprint
}
export interface DefinitionData {
  stage: 'base' | 'target' | 'suite' | 'group'
  config: ExecutionConfig
  steps: RuntimeMiddleware[]
  mocks: RuntimeMock[]
  groups: RuntimeGroup[]
  cases: CaseBlueprint[]
  target: RuntimeTarget | null
  name: string | null
}
export interface Frame {
  steps: RuntimeMiddleware[]
  fields: Fields
}
export interface NodeBase {
  config: ResolvedExecutionConfig
  mocks: RuntimeMock[]
  frames: Frame[]
  frameCount: number
  entryOrigin: SourceLocation | null
  originalIndex?: number
  stable?: Fields
}
export interface SuiteNode extends NodeBase {
  kind: 'test'
  bp: RuntimeSuite
}
export interface GroupNode extends NodeBase {
  kind: 'group'
  bp: RuntimeGroup
  children: ExecutionNode[]
}
export type ExecutionNode = SuiteNode | GroupNode
export type Reason = 'timeout' | 'interrupted' | 'cleanup-failed'
export interface MutableAttempt {
  attempt: number
  status: 'passed' | 'failed' | 'cancelled'
  durationMs: number
  outcome: TargetOutcome | null
  assertions: AssertionResult[]
  failures: Failure[]
  cleanup: 'complete' | 'incomplete'
}
export interface CaseResultBase {
  name: string
  origin: SourceLocation
  path: number[]
  row: { index: number; value: DiagnosticValue } | null
  config: ResolvedExecutionConfig
}
export interface MutableCaseResult extends CaseResultBase {
  durationMs: number
  attempts: MutableAttempt[]
  notRun?: 'todo' | 'skipped' | 'cancelled'
}
export interface MutableTestResult {
  kind: 'test'
  name: string
  path: number[]
  cases: MutableCaseResult[]
}
export interface MutableGroupMiddleware {
  status: 'passed' | 'failed' | 'cancelled' | 'not-run'
  durationMs: number
  failures: GroupMiddlewareFailure[]
  cleanup: 'complete' | 'incomplete'
  reason?: 'no-runnable-cases' | 'cancelled'
}
export interface MutableGroupResult {
  kind: 'group'
  name: string | null
  origin: SourceLocation
  middleware: MutableGroupMiddleware | null
  path: number[]
  children: { origin: SourceLocation; result: MutableNodeResult }[]
}
export type MutableNodeResult = MutableTestResult | MutableGroupResult
export interface MutableRunResult {
  version: 1
  status: 'passed' | 'failed' | 'cancelled'
  reason: Reason | 'completed'
  tests: MutableNodeResult[]
}
export type Deadline = { kind: 'end' } | { kind: 'start'; timeoutMs: number; result: MutableRunResult }
export type Stage = 'before' | 'inside' | 'after' | 'end' | 'contract'
export interface AttemptState {
  reason: Reason | null
  activeAttempt: { phase: ExecutionPhase } | null
  onTimeout?: () => void
}
export interface RunState extends AttemptState {
  partial: MutableNodeResult[]
  activeAttempt: {
    phase: ExecutionPhase
    path: number[]
    base: CaseResultBase
    attempts: MutableAttempt[]
    number: number
    started: number
    timeoutMs: number
  } | null
  activeGroup: { path: number[]; stage: 'before' | 'after' | 'contract'; started: number; timeoutMs: number } | null
  onProgress?: (result: MutableRunResult) => void
  onDeadline?: (deadline: Deadline) => void
  executor: Executor | null
}
export interface InternalRunOptions extends RunOptions {
  filter?: string
  signal?: AbortSignal
  onProgress?: (result: MutableRunResult) => void
  onTimeout?: (result: MutableRunResult) => void
  onDeadline?: (deadline: Deadline) => void
}
export interface Plan {
  blueprints: RuntimeBlueprint[]
  allNodes: ExecutionNode[]
  nodes: ExecutionNode[]
  only: boolean
}
export interface AttemptReply {
  result: MutableAttempt
  retryable: boolean
  reason?: Reason | null
}
export interface GroupReply {
  middleware: MutableGroupMiddleware
  reason: Reason | null
  entered?: false
}
export interface Executor {
  attach(state: RunState, snapshot: (reason: Reason) => MutableRunResult): void
  attempt(path: number[], number: number): Promise<AttemptReply>
  group(path: number[], body: () => Promise<boolean>): Promise<GroupReply>
  close(): Promise<void>
}
export interface ModulePreparation {
  id: string
  keys: string[]
}
export interface RootReference {
  file: string
  name: string
}
export interface CliOptions {
  filter?: string
  reporter?: string
  config?: string
  collectionTimeout?: number
  shutdownGrace?: number
  ci?: boolean
  failOnFlaky?: boolean
  noColor?: boolean
  help?: boolean
  version?: boolean
}
export interface CliWorkerData {
  files: string[]
  options: CliOptions
}
export type Reporter = 'pretty' | 'json'
export type CliMessage =
  | { type: 'loading'; file: string; timeout: number }
  | { type: 'running'; reporter: Reporter; shutdownGrace: number }
  | { type: 'progress' | 'timeout'; result: MutableRunResult }
  | ({ type: 'deadline' } & Deadline)
  | { type: 'result'; result: MutableRunResult; reporter: Reporter }
  | { type: 'error'; message: string }
