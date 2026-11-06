import type { ObservationResult } from '../../domain/result/types.js'
import { ObservationFault, observationResult } from './observation-fault.js'
import { compileChecks, referenceGraph, checkReferences, RuntimeReference, copyData } from '@hanamaru/blueprint/model'
import type { Characteristic, CompiledChecks, Fields, StepPlan } from '@hanamaru/blueprint/model'
import { ObservationOwner } from '@hanamaru/blueprint/model'
import { invoke, objectValue, valueOf, arrayValue } from '../../domain/execution/javascript.js'
import type { Value } from '../../domain/execution/javascript.js'
import { methodValue } from '../../domain/execution/callbacks.js'
import { EvaluationValues, evaluateCheck, CaptureFailure } from './values.js'
import type { CheckEvaluation } from './values.js'

interface Session {
  readonly refs: readonly RuntimeReference[]
  readonly value: object
  readonly milliseconds: number
}

export class ContractEvaluation {
  readonly compiled: CompiledChecks
  readonly values: EvaluationValues
  #interruptedPlan = false
  readonly #sessions: Session[] = []
  readonly #observations = new Map<RuntimeReference, ObservationResult>()
  observation(ref: RuntimeReference): ObservationResult {
    return this.#observations.get(ref) ?? observationResult(ref, this.values)
  }
  readonly #active: () => boolean
  readonly #args: readonly Value[]
  readonly #sample: readonly Value[] | null
  constructor(
    build: object,
    ctx: Readonly<Fields>,
    owner: ObservationOwner,
    mode: Characteristic,
    args: readonly Value[],
    sample: readonly Value[] | null,
    plan: StepPlan | null,
    active: () => boolean,
  ) {
    this.compiled = compileChecks(
      invoke(build, undefined, [ctx, owner, mode, plan]),
      owner,
      mode,
      sample === null ? 'example' : 'property',
    )
    if (plan !== null) {
      const output = plan.output instanceof RuntimeReference ? [plan.output] : Object.values(plan.output)
      const references = referenceGraph(
        [
          ...this.compiled.references,
          ...output,
          ...plan.operations.flatMap((operation) => [
            operation.ref,
            ...operation.args.flatMap((arg) => (arg.kind === 'reference' ? [arg.ref] : [])),
          ]),
        ],
        owner,
      )
      this.compiled = { ...this.compiled, references }
    }
    this.values = new EvaluationValues(this.compiled, { observation: (ref) => this.observation(ref) })
    this.#active = active
    this.#args = args
    this.#sample = sample
    for (const ref of this.compiled.references)
      if (ref.source.kind === 'sample' && sample !== null) this.values.supply(ref, sample[ref.source.index])
    this.values.assertCaptured()
  }
  captureInput(): void {
    for (const ref of this.compiled.references)
      if (ref.source.kind === 'input') this.values.supply(ref, this.#args[ref.source.index])
    this.values.assertCaptured()
  }
  async #read(ref: RuntimeReference, values = this.values): Promise<Value> {
    if (ref.source.kind !== 'state') throw new TypeError('expected state reference')
    const args = ref.source.args.map((arg) => {
      if (arg.kind === 'value') return arg.value
      const resolved = values.data(arg.ref)
      if (resolved.kind === 'error') throw resolved.cause
      if (resolved.kind !== 'value') throw new Error(`state argument unavailable: ${resolved.reason}`)
      return resolved.value
    })
    this.#observations.set(ref, observationResult(ref, values))
    try {
      return valueOf(await invoke(ref.source.token.read, undefined, arrayValue(copyData(args))))
    } catch (cause) {
      throw new ObservationFault(
        observationResult(ref, values),
        ref.source.timing.kind === 'before' ? 'before' : 'after',
        valueOf(cause),
      )
    }
  }
  async before(): Promise<void> {
    const beforeRefs = this.compiled.references.filter(
      (ref) => ref.source.kind === 'state' && ref.source.timing.kind === 'before',
    )
    const dependencies = beforeRefs.length ? referenceGraph(beforeRefs, beforeRefs[0].owner) : []
    const beforeValues = new EvaluationValues({ ...this.compiled, conditions: [], references: dependencies })
    for (const ref of dependencies) {
      if (ref.source.kind === 'input') beforeValues.supply(ref, this.#args[ref.source.index])
      if (ref.source.kind === 'sample' && this.#sample !== null)
        beforeValues.supply(ref, this.#sample[ref.source.index])
    }
    beforeValues.assertCaptured()
    for (const ref of this.compiled.references) {
      if (!this.#active()) throw new Error('evaluation stopped before target')
      if (ref.source.kind === 'state' && ref.source.timing.kind === 'before') {
        try {
          this.values.supply(ref, await this.#read(ref, beforeValues))
        } catch (cause) {
          this.values.reject(ref, valueOf(cause))
          throw new CaptureFailure([valueOf(cause)])
        }
      }
    }
    this.values.assertCaptured()
    const tokens = new Set<object>()
    for (const ref of this.compiled.references) {
      if (ref.source.kind !== 'action' || tokens.has(ref.source.token)) continue
      if (!this.#active()) throw new Error('evaluation stopped before target')
      const token = ref.source.token
      tokens.add(token)
      const refs = this.compiled.references.filter(
        (item) => item.source.kind === 'action' && item.source.token === token,
      )
      try {
        const value = objectValue(valueOf(await invoke(token.open, undefined, [])))
        this.#sessions.push({
          refs,
          value,
          milliseconds: ref.source.window.kind === 'after' ? ref.source.window.milliseconds : 0,
        })
        methodValue(value, 'finish')
        methodValue(value, 'dispose')
      } catch (cause) {
        const fault = new ObservationFault(observationResult(ref, this.values), 'open', valueOf(cause))
        for (const entry of refs) this.values.reject(entry, fault)
        throw new CaptureFailure([fault])
      }
    }
  }
  async step(index: number, value: Value): Promise<void> {
    for (const ref of this.compiled.references)
      if (ref.source.kind === 'step' && ref.source.operation === index) this.values.supply(ref, value)
    this.values.assertCaptured()
    for (const ref of this.compiled.references) {
      if (ref.source.kind !== 'state' || ref.source.timing.kind !== 'after-step') continue
      const step = referenceGraph([ref.source.timing.step], ref.owner).find((entry) => entry.source.kind === 'step')
      if (step?.source.kind !== 'step' || step.source.operation !== index) continue
      try {
        this.values.supply(ref, await this.#read(ref))
      } catch (cause) {
        this.values.reject(ref, valueOf(cause))
        throw new CaptureFailure([valueOf(cause)])
      }
      this.values.assertCaptured()
    }
  }
  argument(ref: RuntimeReference): Value {
    const actual = this.values.raw(ref)
    if (actual.kind === 'error') throw actual.cause
    if (actual.kind !== 'value') throw new TypeError('step argument is unavailable')
    return actual.value
  }
  async after(kind: 'return' | 'throw' | null, value: Value, terminalReached = true): Promise<void> {
    if (kind === null) this.#interruptedPlan = true
    this.values.ended(kind)
    const settled = performance.now()
    const actions = this.#sessions.map(async (session) => {
      try {
        const wait = Math.max(0, session.milliseconds - (performance.now() - settled))
        if (wait) await new Promise<void>((resolve) => setTimeout(resolve, wait))
        if (!this.#active()) throw new Error('evaluation stopped during action observation')
        const events = arrayValue(valueOf(await invoke(methodValue(session.value, 'finish'), session.value, [])))
        for (const ref of session.refs) this.values.supply(ref, events)
      } catch (cause) {
        for (const ref of session.refs)
          this.values.reject(ref, new ObservationFault(observationResult(ref, this.values), 'finish', valueOf(cause)))
      }
    })
    for (const ref of this.compiled.references) {
      if (ref.source.kind === 'result' && kind === 'return') this.values.supply(ref, value)
      if (terminalReached && ref.source.kind === 'error' && kind === 'throw') this.values.supply(ref, value)
      if (kind !== null && terminalReached && ref.source.kind === 'outcome')
        this.values.supply(ref, kind === 'return' ? { kind, value } : { kind, error: value })
    }
    const states = this.compiled.references.filter(
      (ref) => ref.source.kind === 'state' && ref.source.timing.kind === 'after-plan',
    )
    await Promise.all([
      ...actions,
      ...states.map(async (ref) => {
        try {
          if (!this.#active()) throw new Error('evaluation stopped before state observation')
          if (
            ref.source.kind === 'state' &&
            ref.source.args.some((arg) => arg.kind === 'reference' && this.values.data(arg.ref).kind === 'missing')
          )
            return
          let actual = await this.#read(ref)
          if (
            !this.#interruptedPlan &&
            ref.source.kind === 'state' &&
            ref.source.timing.kind === 'after-plan' &&
            ref.source.timing.wait
          ) {
            const { withinMs, intervalMs } = ref.source.timing.wait
            while (this.#active() && performance.now() - settled < withinMs) {
              const candidate = new EvaluationValues(this.compiled, {
                initializeConstants: false,
                observation: (entry) => this.observation(entry),
              })
              candidate.supply(ref, actual)
              const related = this.compiled.conditions.filter((condition) => this.dependsOn(condition.check, ref))
              const checks = related.map((condition) => evaluateCheck(condition.check, candidate))
              for (const check of checks) if (check.status === 'error') throw check.cause
              if (checks.every((check) => check.status === 'passed')) break
              await new Promise<void>((resolve) =>
                setTimeout(resolve, Math.min(intervalMs, Math.max(0, withinMs - (performance.now() - settled)))),
              )
              if (!this.#active() || performance.now() - settled >= withinMs) break
              actual = await this.#read(ref)
            }
          }
          this.values.supply(ref, actual)
        } catch (cause) {
          this.values.reject(ref, valueOf(cause))
        }
      }),
    ])
  }
  dependsOn(check: import('@hanamaru/blueprint/model').Check, ref: RuntimeReference): boolean {
    if (!('ref' in check)) return false
    let source = check.ref
    while (source !== ref && 'parent' in source.source) source = source.source.parent
    return source === ref
  }
  evaluate(): readonly CheckEvaluation[] {
    return this.compiled.conditions.map((condition) => {
      if (!this.#active())
        return { status: 'not-evaluated', pending: true, reason: 'evaluation stopped before the condition' }
      const refs = checkReferences(condition.check)
      const graph = refs.length ? referenceGraph(refs, refs[0].owner) : []
      if (
        this.#interruptedPlan &&
        graph.some(
          (ref) =>
            ref.source.kind === 'action' || (ref.source.kind === 'state' && ref.source.timing.kind === 'after-plan'),
        )
      ) {
        for (const ref of graph) {
          const fault = this.values.captureFailure(ref)
          if (fault) return { status: 'error', phase: 'observe', cause: fault.cause }
        }
        return { status: 'not-evaluated', reason: 'plan was interrupted by a capture or observation failure' }
      }
      return evaluateCheck(condition.check, this.values)
    })
  }
  async close(): Promise<readonly Value[]> {
    const errors: Value[] = []
    for (const session of [...this.#sessions].reverse()) {
      try {
        await invoke(methodValue(session.value, 'dispose'), session.value, [])
      } catch (cause) {
        for (const ref of session.refs)
          errors.push(new ObservationFault(observationResult(ref, this.values), 'dispose', valueOf(cause)))
      }
    }
    return errors
  }
}
