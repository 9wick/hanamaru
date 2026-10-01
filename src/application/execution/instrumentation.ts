import type { ResolvedCallAssertion } from '../../domain/assertion/runtime.js'
import { methodValue } from '../../domain/definition/operations.js'
import type { RuntimeMock, RuntimeTarget } from '../../domain/definition/runtime.js'
import type { BehaviorBlueprint } from '../../domain/definition/types.js'
import type { Value } from '../../foundation/value.js'
import { invoke, valueOf } from '../../foundation/value.js'
import { CleanupFault } from './faults.js'

/** 差し替えか記録の対象。behaviorがnullなら本物を呼びつつ呼び出しだけ記録する。 */
type Instrumented = Omit<RuntimeMock, 'behavior'> & { behavior: BehaviorBlueprint | null }

function executeAction(action: BehaviorBlueprint, state: { index: number }, thisArg: Value, args: Value[]): Value {
  const selected =
    action.kind === 'sequence'
      ? state.index < action.once.length
        ? action.once[state.index++]
        : action.fallback
      : action
  switch (selected.kind) {
    case 'returns':
      return selected.value
    case 'resolves':
      return Promise.resolve(selected.value)
    case 'throws':
      throw selected.error
    case 'rejects':
      return Promise.reject(selected.error)
    case 'callsFake':
      return invoke(selected.fn, thisArg, args)
  }
}

/** 同じメソッドのmockとcall観測を1つの包みにまとめる。対象メソッド自身のmockは契約違反。 */
function instrumentedMethods(
  mocks: RuntimeMock[],
  calls: readonly ResolvedCallAssertion[],
  target: RuntimeTarget,
): Instrumented[] {
  const entries: Instrumented[] = [...mocks]
  for (const call of calls)
    if (!entries.some((x) => x.object === call.object && x.key === call.key))
      entries.push({ object: call.object, key: call.key, behavior: null })
  if (
    target.kind === 'method' &&
    entries.some(
      (x) => (x.object === target.object || x.sourceObject === target.object) && x.key === target.key && x.behavior,
    )
  )
    throw new TypeError('target method cannot be mocked')
  return entries
}

function restoreMethods(actions: (() => Value | void)[]): Value[] {
  const errors: Value[] = []
  for (const action of [...actions].reverse())
    try {
      if (action() === false) throw new Error('method restoration failed')
    } catch (error) {
      errors.push(valueOf(error))
    }
  return errors
}

/**
 * 1回のattemptのあいだメソッドを差し替え、呼び出しを記録する仕掛け。
 * 呼び出し記録はただのデータとして取り出し、元に戻す手順はこの仕掛けが持つ。
 */
export class MethodPatch {
  readonly records = new Map<object, Map<string, Value[][]>>()
  readonly #undo: (() => Value | void)[] = []
  #recording = true

  /** 途中で仕掛けられないメソッドに当たったら、そこまでの差し替えを戻してから投げ直す。 */
  constructor(mocks: RuntimeMock[], calls: readonly ResolvedCallAssertion[], target: RuntimeTarget) {
    const entries = instrumentedMethods(mocks, calls, target)
    try {
      for (const entry of entries) this.#patch(entry)
    } catch (error) {
      const errors = restoreMethods(this.#undo)
      if (errors.length) throw new CleanupFault([valueOf(error), ...errors])
      throw error
    }
  }

  #patch(entry: Instrumented): void {
    const object = entry.object,
      key = entry.key
    const own = Object.getOwnPropertyDescriptor(object, key)
    const original = methodValue(object, key)
    if (
      typeof original !== 'function' ||
      (own && (!('value' in own) || (!own.configurable && !own.writable))) ||
      (!own && !Object.isExtensible(object))
    )
      throw new TypeError(`method ${key} cannot be instrumented`)
    const state = { index: 0 }
    const history: Value[][] = []
    this.records.set(object, (this.records.get(object) ?? new Map<string, Value[][]>()).set(key, history))
    const recording = () => this.#recording
    // 差し替えたメソッドは呼び出し側のthisを引き継ぐため、arrowにはできない。
    const wrapped = function (this: Value, ...args: Value[]) {
      if (recording()) history.push(args)
      return entry.behavior ? executeAction(entry.behavior, state, this, args) : invoke(original, this, args)
    }
    if (own && !own.configurable) {
      if (!Reflect.set(object, key, wrapped)) throw new TypeError(`method ${key} cannot be instrumented`)
      this.#undo.push(() => Reflect.set(object, key, original))
    } else {
      Object.defineProperty(object, key, {
        configurable: true,
        enumerable: own?.enumerable ?? true,
        writable: true,
        value: wrapped,
      })
      this.#undo.push(() => (own ? Object.defineProperty(object, key, own) : Reflect.deleteProperty(object, key)))
    }
  }

  /** 対象の呼び出しが終わったあとの呼び出しは、期待の組み立て側のものなので記録に残さない。 */
  stopRecording(): void {
    this.#recording = false
  }

  /** 差し替えを逆順に戻す。戻せなかったものは例外にせず、呼び出し側へ理由として返す。 */
  restore(): Value[] {
    return restoreMethods(this.#undo)
  }
}
