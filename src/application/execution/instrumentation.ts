import type { ResolvedCallAssertion } from '../../domain/assertion/runtime.js'
import { methodValue } from '../../domain/definition/operations.js'
import type { RuntimeMock, RuntimeTarget } from '../../domain/definition/runtime.js'
import type { BehaviorBlueprint } from '../../domain/definition/types.js'
import type { Value } from '../../foundation/value.js'
import { invoke, valueOf } from '../../foundation/value.js'
import { CleanupFault } from './faults.js'

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

export function patchMethods(mocks: RuntimeMock[], calls: readonly ResolvedCallAssertion[], target: RuntimeTarget) {
  const entries: (Omit<RuntimeMock, 'behavior'> & { behavior: BehaviorBlueprint | null })[] = [...mocks]
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
  const records = new Map<object, Map<string, Value[][]>>(),
    restore: (() => Value | void)[] = []
  let recording = true
  try {
    for (const entry of entries) {
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
      records.set(object, (records.get(object) ?? new Map<string, Value[][]>()).set(key, history))
      const wrapped = function (this: Value, ...args: Value[]) {
        if (recording) history.push(args)
        return entry.behavior ? executeAction(entry.behavior, state, this, args) : invoke(original, this, args)
      }
      if (own && !own.configurable) {
        if (!Reflect.set(object, key, wrapped)) throw new TypeError(`method ${key} cannot be instrumented`)
        restore.push(() => Reflect.set(object, key, original))
      } else {
        Object.defineProperty(object, key, {
          configurable: true,
          enumerable: own?.enumerable ?? true,
          writable: true,
          value: wrapped,
        })
        restore.push(() => (own ? Object.defineProperty(object, key, own) : Reflect.deleteProperty(object, key)))
      }
    }
  } catch (error) {
    const errors = restoreMethods(restore)
    if (errors.length) throw new CleanupFault([valueOf(error), ...errors])
    throw error
  }
  return {
    records,
    restore,
    stopRecording: () => {
      recording = false
    },
  }
}

export function restoreMethods(actions: (() => Value | void)[]): Value[] {
  const errors: Value[] = []
  for (const action of [...actions].reverse())
    try {
      if (action() === false) throw new Error('method restoration failed')
    } catch (error) {
      errors.push(valueOf(error))
    }
  return errors
}
