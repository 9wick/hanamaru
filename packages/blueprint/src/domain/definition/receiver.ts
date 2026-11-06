import type { AnyFn } from './target-types.js'
import { MethodOperation } from './scenario.js'
import type { RuntimeTarget, Fields } from './runtime.js'
import { functionValue, invoke, objectValue, valueOf } from './javascript.js'
import { methodValue } from './operations.js'

/** 呼び出しを始める前にインスタンスの所属と公開操作のデータ記述子を検査する。 */
export function resolveReceiver(
  target: RuntimeTarget,
  ctx: Readonly<Fields>,
): Exclude<RuntimeTarget, { kind: 'instance' }> {
  if (target.kind !== 'instance') return target
  if (target.from === null) throw new TypeError('class target requires from')
  const instance = objectValue(invoke(target.from, undefined, [ctx]))
  if (!(instance instanceof functionValue(target.ctor)))
    throw new TypeError('from must supply an instance of the declared class')
  return { kind: 'method', object: instance, key: target.key, fn: methodValue(instance, target.key) }
}

interface ResolvedOperation {
  readonly fn: AnyFn
  readonly receiver: object | undefined
}
export function resolveOperations(
  target: RuntimeTarget,
  ctx: Readonly<Fields>,
): Readonly<Record<string, ResolvedOperation>> {
  if (target.kind !== 'scenario') {
    const resolved = resolveReceiver(target, ctx)
    if (resolved.kind === 'scenario') throw new TypeError('steps require declared operations')
    return Object.freeze({
      target: { fn: resolved.fn, receiver: resolved.kind === 'method' ? resolved.object : undefined },
    })
  }
  const supplied = target.from === null ? {} : objectValue(invoke(target.from, undefined, [ctx]))
  const methodKeys = Object.entries(target.members)
    .filter(([, member]) => member instanceof MethodOperation)
    .map(([key]) => key)
  if (Reflect.ownKeys(supplied).some((key) => typeof key !== 'string' || !methodKeys.includes(key)))
    throw new TypeError('from contains undeclared receiver keys')
  return Object.freeze(
    Object.fromEntries(
      Object.entries(target.members).map(([key, member]): [string, ResolvedOperation] => {
        if (!(member instanceof MethodOperation)) return [key, { fn: member, receiver: undefined }]
        const descriptor = Object.getOwnPropertyDescriptor(supplied, key)
        if (!descriptor || !('value' in descriptor))
          throw new TypeError('from must supply each method receiver as a data property')
        const instance = objectValue(valueOf(descriptor.value))
        if (!(instance instanceof functionValue(member.ctor)))
          throw new TypeError('from must supply an instance of the declared class')
        return [key, { fn: methodValue(instance, member.key), receiver: instance }]
      }),
    ),
  )
}
