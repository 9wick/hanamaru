import type { CallPlan } from '@hanamaru/blueprint/model'
import { CallDescriptor, descriptor, plannedCalls } from '@hanamaru/blueprint/model'
import { methodValue } from '../../domain/execution/callbacks.js'
import type { RuntimeTarget } from '@hanamaru/blueprint/model'
import type { Value } from '../../domain/execution/javascript.js'
import { invoke, objectValue, property, valueOf } from '../../domain/execution/javascript.js'

function callName(call: CallDescriptor): string {
  return `${call.member ?? 'target'} #${call.id}`
}

export class InvocationFault extends Error {
  readonly failed: string
  readonly notRun: readonly string[]
  constructor(cause: Value, call: CallDescriptor, remaining: readonly CallDescriptor[]) {
    const failed = callName(call),
      notRun = remaining.map(callName)
    super(`call ${failed} failed${notRun.length ? `; not run: ${notRun.join(', ')}` : ''}`, { cause })
    this.failed = failed
    this.notRun = notRun
  }
}

/** 結果はattemptのローカル値。retryや別のrunへキャッシュを持ち越さない。 */
export async function executeInvocations(
  plan: CallPlan,
  target: RuntimeTarget,
  active: () => boolean,
): Promise<{ readonly value: Value }> {
  const calls = plannedCalls(plan, target)
  const results = new Map<CallDescriptor, Value>()
  const resultOf = (ref: CallDescriptor): Value => {
    if (!results.has(ref)) throw new TypeError('call dependency has no normal result')
    return results.get(ref)
  }
  for (const [index, call] of calls.entries()) {
    if (!active()) throw new Error(`call plan stopped before ${callName(call)}`)
    const args = call.args.map((arg) => {
      const dependency = descriptor(arg)
      return dependency ? resultOf(dependency) : arg
    })
    try {
      const value =
        target.kind === 'relation'
          ? invoke(objectValue(property(target.members, call.member ?? '')), undefined, args)
          : target.kind === 'method'
            ? invoke(methodValue(target.object, target.key), target.object, args)
            : invoke(target.fn, undefined, args)
      results.set(call, valueOf(await value))
    } catch (error) {
      throw new InvocationFault(valueOf(error), call, calls.slice(index + 1))
    }
  }
  return {
    value:
      plan.output instanceof CallDescriptor
        ? resultOf(plan.output)
        : Object.fromEntries(Object.entries(plan.output).map(([name, ref]) => [name, resultOf(ref)])),
  }
}
