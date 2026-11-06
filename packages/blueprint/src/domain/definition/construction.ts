import { ScenarioDefinition, MethodOperation } from './scenario.js'
import type { Resource } from './resource.js'
import { checkedResources } from './resource.js'
import type { Value } from './javascript.js'
import { functionValue, objectValue, property } from './javascript.js'
import type { ExecutionConfig } from './conditions.js'
import { positive, retryCount } from './conditions.js'
import { methodValue } from './operations.js'
import type {
  Characteristic,
  CaseBlueprint,
  CaseData,
  DefinitionData,
  RuntimeArgs,
  RuntimeBlueprint,
  RuntimeCase,
  RuntimeGroup,
  RuntimeMiddleware,
  RuntimeTarget,
  RuntimeTodo,
} from './runtime.js'
import { doneTag, middlewareTag } from './tags.js'
import type { SourceLocation } from './types.js'
import { checkedMiddleware } from './validation.js'

export function emptyDefinition(): DefinitionData {
  return { stage: 'base', config: {}, steps: [], groups: [], cases: [], target: null, name: null }
}

export function emptyCase(): CaseData {
  return { config: {}, args: null, expect: null }
}

export function withTimeout<T extends { config: ExecutionConfig }>(data: T, ms: number) {
  return { ...data, config: { ...data.config, timeout: positive(ms, 'timeout') } }
}

export function withRetry<T extends { config: ExecutionConfig }>(data: T, count: number) {
  return { ...data, config: { ...data.config, retry: retryCount(count) } }
}

// 以下の4つの前提検査は、利用者のコールバックを呼ぶ前に弾くために遷移本体から分けてある。
// 呼び出し元が評価順を決められないと、失敗した呼び出しでもコールバックが走ってしまう。

export function settingAllowed(data: DefinitionData): void {
  if (data.stage === 'group' || data.stage === 'suite')
    throw new TypeError('common settings are fixed after the first group or case')
}

export function withCharacteristic(data: DefinitionData, characteristic: Characteristic): DefinitionData {
  if (data.stage !== 'target') throw new TypeError('declare pure/effectful after target and before cases')
  if (data.characteristic !== undefined) throw new TypeError('target characteristic is already declared')
  return { ...data, characteristic }
}

export function caseAllowed(data: DefinitionData): void {
  if (
    data.target?.kind === 'scenario' &&
    data.target.from === null &&
    Object.values(data.target.members).some((member) => member instanceof MethodOperation)
  )
    throw new TypeError('scenario methods require from before cases')
  if (data.target?.kind === 'instance' && data.target.from === null)
    throw new TypeError('class target requires from before cases')
  if (data.stage !== 'target' && data.stage !== 'suite') throw new TypeError('select target before cases')
}

export function groupAllowed(data: DefinitionData): void {
  if (data.stage !== 'base' && data.stage !== 'group') throw new TypeError('group requires a group builder')
}

export function withResource<T extends { resources?: readonly Resource[] }>(data: T, resource: Resource): T {
  return { ...data, resources: checkedResources([...(data.resources ?? []), resource]) }
}

export function withStep(data: DefinitionData, step: RuntimeMiddleware): DefinitionData {
  if (step.kind !== 'middleware' && step.kind !== 'environment') throw new TypeError('invalid preparation kind')
  if (step.kind === 'environment' && data.characteristic !== 'effectful')
    throw new TypeError('environment requires an effectful target')
  return { ...data, steps: [...data.steps, step] }
}

export function selectTarget(data: DefinitionData, input: readonly Value[]): DefinitionData {
  if (data.stage !== 'base') throw new TypeError('target already selected')
  const [first, ...rest] = input
  const name = typeof first === 'string' && rest.length ? first : null
  const args = name === null ? input : rest
  const [subject, key] = args
  let target: RuntimeTarget
  if (args.length === 1 && typeof subject === 'function') target = { kind: 'function', fn: functionValue(subject) }
  else if (args.length === 1 && subject instanceof ScenarioDefinition)
    target = { kind: 'scenario', members: subject.members, from: null }
  else if (args.length === 2 && typeof subject === 'function' && typeof key === 'string')
    target = { kind: 'instance', ctor: subject, key, from: null }
  else if (args.length === 2 && subject && typeof key === 'string')
    target = { kind: 'method', object: objectValue(subject), key, fn: methodValue(subject, key) }
  else throw new TypeError('target requires a function or object method')
  return {
    ...data,
    stage: 'target',
    name:
      name ??
      (target.kind === 'scenario'
        ? Object.keys(target.members).join(' / ')
        : target.kind === 'method' || target.kind === 'instance'
          ? target.key
          : functionValue(target.fn).name || '<anonymous>'),
    target: Object.freeze(target),
  }
}

export function caseName(name: Value): string {
  if (typeof name !== 'string') throw new TypeError('case name must be a string')
  return name
}

export function todoCase(name: string, origin: SourceLocation): RuntimeTodo {
  return { name, caseKind: 'todo', mode: 'todo', origin, row: null, config: {} }
}

export function addCase(data: DefinitionData, item: CaseBlueprint): DefinitionData {
  return { ...data, stage: 'suite', cases: [...data.cases, item] }
}

/** groupの引数はname・middleware・子の配列の順で省略できる。子自体の検査は呼び出し元が行う。 */
export function groupArguments(input: readonly Value[]): {
  name: string | null
  middleware: RuntimeMiddleware | null
  children: Value
} {
  const [first, ...rest] = input
  const name = typeof first === 'string' ? first : null
  const args = name === null ? input : rest
  const head = args[0]
  const middleware =
    head !== null && typeof head === 'object' && property(head, middlewareTag) === true ? checkedMiddleware(head) : null
  const children = middleware ? args.slice(1) : args
  if (children.length !== 1) throw new TypeError('group requires completed children')
  return { name, middleware, children: children[0] }
}

export function addGroup(
  data: DefinitionData,
  group: {
    name: string | null
    origin: SourceLocation
    middleware: RuntimeMiddleware | null
    children: { origin: SourceLocation; blueprint: RuntimeBlueprint }[]
  },
): DefinitionData {
  const node: RuntimeGroup = { version: 1, kind: 'group', config: {}, steps: [], ...group }
  return { ...data, stage: 'group', groups: [...data.groups, node] }
}

export function toBlueprint(data: DefinitionData): RuntimeBlueprint {
  if (data.stage === 'suite') {
    if (data.name === null || data.target === null) throw new TypeError('test definition is incomplete')
    return {
      ...(data.resources ? { resources: data.resources } : {}),
      version: 1,
      kind: 'test',
      characteristic: data.characteristic ?? 'pure',
      name: data.name,
      target: data.target,
      cases: [...data.cases],
      config: { ...data.config },
      steps: [...data.steps],
    }
  }
  if (data.stage === 'group')
    return {
      ...(data.resources ? { resources: data.resources } : {}),
      version: 1,
      kind: 'definition',
      config: { ...data.config },
      steps: [...data.steps],
      children: [...data.groups],
    }
  throw new TypeError('test definition is incomplete')
}

export function caseDone(data: CaseData): true {
  if (!data[doneTag]) throw new TypeError('case must return args and an expectation')
  return true
}

export function withArgs(data: CaseData, args: RuntimeArgs): CaseData {
  if (data.args !== null) throw new TypeError('args, argsFrom and steps can only be selected once')
  return { ...data, args }
}

export function withExpectation(data: CaseData, build: object): CaseData {
  if (data.expect) throw new TypeError('expect already set')
  return { ...data, [doneTag]: true, expect: { kind: 'contract', build } }
}

export function completedCase(
  data: CaseData,
  base: { name: string; mode: RuntimeCase['mode']; origin: SourceLocation; row: CaseBlueprint['row'] },
): RuntimeCase {
  if (!data[doneTag] || !data.args || !data.expect) throw new TypeError('case must return args and an expectation')
  if (data.args.kind === 'generated') throw new TypeError('generated inputs require a property case')
  return {
    ...base,
    caseKind: 'example',
    ...(data.resources ? { resources: data.resources } : {}),
    config: data.config,
    args: data.args,
    expect: data.expect,
  }
}

export function withReceiver(data: DefinitionData, from: object): DefinitionData {
  if (data.stage !== 'target' || (data.target?.kind !== 'instance' && data.target?.kind !== 'scenario'))
    throw new TypeError('from requires a class target before cases')
  if (data.target.from !== null) throw new TypeError('from is already set')
  if (typeof from !== 'function') throw new TypeError('from requires an instance provider')
  return { ...data, target: Object.freeze({ ...data.target, from }) }
}
