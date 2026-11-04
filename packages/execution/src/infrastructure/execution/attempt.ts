import { withFailureReferences } from '@hanamaru/execution-protocol'
import { CaptureFailure } from '../../application/execution/values.js'
import { runProperty } from '../../application/execution/property-run.js'
import { ContractEvaluation } from '../../application/execution/contract-evaluation.js'
import { contractReport, pendingAssertions } from './contract-report.js'
import {
  ObservationOwner,
  resolveReceiver,
  resolveOperations,
  compileSteps,
  RuntimeReference,
  copyData,
} from '@hanamaru/blueprint/model'
import { Injectable, inject } from '@zeltjs/core'
import type { Fields, RuntimeCase } from '@hanamaru/blueprint/model'
import { configWith } from '../../domain/execution/config.js'
import type { SuiteNode } from '../../domain/execution/model.js'
import { diagnostic } from '../../domain/result/diagnostic.js'
import type { MutableAttempt, Reason } from '../../domain/result/mutable.js'
import type {
  AssertionResult,
  ExecutionPhase,
  Failure,
  TargetOutcome,
  OperationResult,
  DiagnosticValue,
} from '../../domain/result/types.js'
import type { Value } from '../../domain/execution/javascript.js'
import { arrayValue, invoke, valueOf } from '../../domain/execution/javascript.js'
import type { AttemptReply } from '../../application/ports/executor.js'
import { failure, faultToFailure } from './failure.js'
import { now } from '../../application/execution/clock.js'
import { CaseFailed, CleanupFault, MiddlewareFault, EvaluationFault } from '../../application/execution/faults.js'
import { withMiddleware } from '../../application/execution/middleware.js'
import { StageTimer } from '../../application/execution/services.js'
import { ExecutionLifecycle } from '../../application/execution/lifecycle.js'

/** 1回のattemptが積み上げる観測結果。結果の形に変えるのは最後の1か所だけ。 */
type AttemptRecord = {
  operations: OperationResult[]
  expectedTermination: 'return' | 'throw' | 'return-or-throw' | null
  terminationTarget: number | null
  input: DiagnosticValue | null
  outcome: TargetOutcome | null
  readonly failures: Failure[]
  readonly assertions: AssertionResult[]
  cleanup: 'complete' | 'incomplete'
  retryable: boolean
}

/** 例外をattemptの記録へ翻訳した判定。runを打ち切るかどうかは呼び出し側がtrackerへ渡す。 */
type AttemptFault = {
  readonly failures: readonly Failure[]
  readonly cleanup: 'complete' | 'incomplete'
  readonly retryable: boolean
  readonly abort: Reason | null
}

/** 後処理の失敗は再試行しても直らないため、retryableを落としてrunも打ち切る。 */
function classifyAttemptError(error: Value, phase: ExecutionPhase): AttemptFault {
  if (error instanceof CleanupFault)
    return {
      failures: error.errors
        .filter((issue) => !(issue instanceof CaseFailed))
        .map((issue) =>
          issue instanceof EvaluationFault
            ? faultToFailure(issue.cause, issue.phase)
            : faultToFailure(issue, 'cleanup'),
        ),
      cleanup: error.incomplete ? 'incomplete' : 'complete',
      retryable: false,
      abort: 'cleanup-failed',
    }
  if (error instanceof CaseFailed) return { failures: [], cleanup: 'complete', retryable: true, abort: null }
  if (error instanceof MiddlewareFault && error.stage === 'contract')
    return {
      failures: [
        error instanceof EvaluationFault ? faultToFailure(error.cause, error.phase) : faultToFailure(error, phase),
      ],
      cleanup: 'complete',
      retryable: false,
      abort: null,
    }
  if (error instanceof MiddlewareFault && error.stage === 'after' && error.kind !== 'timeout')
    return {
      failures: [
        error instanceof EvaluationFault ? faultToFailure(error.cause, error.phase) : faultToFailure(error, phase),
      ],
      cleanup: 'incomplete',
      retryable: false,
      abort: 'cleanup-failed',
    }
  return {
    failures: [
      error instanceof EvaluationFault ? faultToFailure(error.cause, error.phase) : faultToFailure(error, phase),
    ],
    cleanup: 'complete',
    retryable: true,
    abort: null,
  }
}

function finalizeAttempt(
  record: AttemptRecord,
  number: number,
  durationMs: number,
  reason: Reason | null,
): MutableAttempt {
  return {
    attempt: number,
    operations: record.operations,
    expectedTermination: record.expectedTermination,
    terminationTarget: record.terminationTarget,
    status: record.failures.length ? 'failed' : reason === 'interrupted' ? 'cancelled' : 'passed',
    durationMs,
    outcome: record.outcome,
    assertions: record.assertions,
    failures: record.failures,
    cleanup: record.cleanup,
  }
}

/**
 * 1回のattemptを走らせる。どの節のどのcaseを何回目に走らせるかは、実行ごとの指定として引数で受け取る。
 * 実行状態の更新と観測は、同じruntimeのExecutionLifecycleに委ねる。
 */
@Injectable()
export class AttemptExecutor {
  readonly #propertySeeds = new WeakMap<object, number>()
  readonly #lifecycle: ExecutionLifecycle

  constructor(lifecycle = inject(ExecutionLifecycle)) {
    this.#lifecycle = lifecycle
  }

  async execute(
    node: SuiteNode,
    item: RuntimeCase,
    number: number,
    progress?: (result: MutableAttempt, phase: ExecutionPhase) => void,
  ): Promise<AttemptReply> {
    const config = configWith(node.config, item.config)
    const timer = new StageTimer<ExecutionPhase>(config.timeout, 'prepare', (phase) => {
      this.#lifecycle.markPhase(phase)
      this.#lifecycle.timedOut()
    })
    try {
      if (item.args.kind === 'generated') {
        const input = item.args.input
        const seed = input.seed ?? this.#propertySeeds.get(input) ?? Math.floor(Math.random() * 0x100000000)
        this.#propertySeeds.set(input, seed)
        progress?.(
          {
            attempt: number,
            status: 'cancelled',
            durationMs: 0,
            outcome: null,
            assertions: [],
            failures: [],
            cleanup: 'incomplete',
            evaluations: [],
            operations: [],
            expectedTermination: null,
            terminationTarget: null,
            property: {
              source: diagnostic(input.source),
              classification: input.classification,
              seed,
              version: input.version,
              runs: input.runs,
              maxShrinks: input.maxShrinks,
              originalCounterexample: null,
              counterexample: null,
              shrinkPath: [],
              stopped: 'completed',
            },
          },
          'prepare',
        )
        return await runProperty(
          { ...input, seed },
          (sample, report) => this.#evaluate(node, item, number, sample, timer, report),
          () => this.#lifecycle.reason === null,
          progress,
        )
      }
      return await this.#evaluate(node, item, number, null, timer, progress)
    } finally {
      timer.clear()
    }
  }
  async #evaluate(
    node: SuiteNode,
    item: RuntimeCase,
    number: number,
    sample: Value[] | null,
    timer: StageTimer<ExecutionPhase>,
    progress?: (result: MutableAttempt, phase: ExecutionPhase) => void,
  ): Promise<AttemptReply> {
    const lifecycle = this.#lifecycle
    const config = configWith(node.config, item.config)
    const owner = new ObservationOwner()
    const selectedSample = sample === null ? null : arrayValue(copyData(sample))
    const started = now()
    const record: AttemptRecord = {
      operations: [],
      expectedTermination: null,
      terminationTarget: null,
      input: null,
      outcome: null,
      failures: [],
      assertions: [],
      cleanup: 'complete',
      retryable: true,
    }
    let contract: ContractEvaluation | undefined
    let pendingFailure: Failure | undefined
    const publish = () => {
      if (!progress) return
      const partial = finalizeAttempt(record, number, now() - started, 'interrupted')
      partial.operations = [...record.operations]
      partial.assertions = record.assertions.length
        ? [...record.assertions]
        : contract
          ? pendingAssertions(contract)
          : []
      partial.failures = [...record.failures, ...(pendingFailure ? [pendingFailure] : [])]
      partial.status = partial.failures.length ? 'failed' : 'cancelled'
      partial.cleanup = 'incomplete'
      if (sample === null)
        partial.evaluations = [
          {
            kind: 'example',
            sampleIndex: null,
            input: record.input ?? { kind: 'omitted', reason: 'input was not bound' },
            operations: partial.operations,
            expectedTermination: record.expectedTermination,
            terminationTarget: record.terminationTarget,
            status: partial.status,
            outcome: partial.outcome,
            assertions: partial.assertions,
            failureIndexes: partial.failures.map((_, index) => index),
            cleanup: 'incomplete',
          },
        ]
      progress(withFailureReferences(partial), timer.stage)
    }
    const enter = (phase: ExecutionPhase) => {
      timer.enter(phase)
      publish()
    }
    enter('prepare')
    const core = async (ctx: Readonly<Fields>) => {
      if (timer.overdue()) return
      let startedTarget = false
      let failed = false,
        originalError
      try {
        enter('compile')
        const stepsBuild =
          item.args.kind === 'steps'
            ? item.args.build
            : item.args.kind === 'generated' && item.args.binding.kind === 'steps'
              ? item.args.binding.build
              : null
        const resolvedTarget = stepsBuild === null ? resolveReceiver(node.bp.target, ctx) : null
        const operations = stepsBuild === null ? null : resolveOperations(node.bp.target, ctx)
        const plan =
          stepsBuild !== null && operations !== null
            ? compileSteps(owner, Object.keys(operations), stepsBuild, ctx, sample)
            : null
        enter('compile')
        const args =
          item.args.kind === 'generated'
            ? item.args.binding.kind === 'sample'
              ? arrayValue(sample)
              : item.args.binding.kind === 'steps'
                ? []
                : arrayValue(invoke(item.args.binding.build, undefined, [ctx, sample]))
            : item.args.kind === 'steps'
              ? []
              : item.args.kind === 'value'
                ? item.args.value
                : arrayValue(invoke(item.args.build, undefined, [ctx]))
        if (!Array.isArray(args)) throw new TypeError('argsFrom must return an array')
        record.input = diagnostic(selectedSample ?? args)
        record.terminationTarget = plan?.final?.index ?? null
        record.operations =
          plan === null
            ? []
            : plan.operations.map((operation) => ({
                failureIndexes: [],
                index: operation.index,
                key: operation.key,
                mode: operation.final ? 'final' : 'return-required',
                status: 'not-run',
                reason: 'operation was not reached',
              }))
        if (item.expect) {
          enter('compile')
          contract = new ContractEvaluation(
            item.expect.build,
            ctx,
            owner,
            node.bp.characteristic,
            args,
            selectedSample,
            plan,
            () => !timer.overdue() && lifecycle.reason === null,
          )
          record.expectedTermination = contract.compiled.termination
          enter('before')
          await contract.before()
        }
        if (timer.overdue() || lifecycle.reason !== null) throw new Error('evaluation stopped before target')
        contract?.captureInput()
        record.input = diagnostic(selectedSample ?? args)
        enter('target')
        startedTarget = true
        let rawValue
        let outcomeKind: TargetOutcome['kind'] = 'return'
        let prefixFailure: number | null = null
        if (plan !== null) {
          if (!contract) throw new TypeError('steps require an expectation')
          const stepsContract = contract
          for (const operation of plan.operations) {
            if (timer.overdue() || lifecycle.reason !== null) throw new Error('operation plan was interrupted')
            enter('checkpoint')
            const parameters = operation.args.map((arg) =>
              arg.kind === 'literal' ? arg.value : stepsContract.argument(arg.ref),
            )
            enter('target')
            const selected = operations?.[operation.key]
            if (!selected) throw new TypeError('operation is outside the declared target')
            const observedArgs = parameters.map((value) => diagnostic(value))
            record.operations[operation.index] = {
              failureIndexes: [],
              index: operation.index,
              key: operation.key,
              mode: operation.final ? 'final' : 'return-required',
              status: 'incomplete',
              args: observedArgs,
              reason: 'operation did not settle',
            }
            publish()
            try {
              rawValue = valueOf(await invoke(selected.fn, selected.receiver, parameters))
            } catch (error) {
              rawValue = valueOf(error)
              outcomeKind = 'throw'
              record.operations[operation.index] = {
                failureIndexes: [],
                index: operation.index,
                key: operation.key,
                mode: operation.final ? 'final' : 'return-required',
                status: 'threw',
                args: observedArgs,
                value: diagnostic(rawValue),
              }
              if (!operation.final) prefixFailure = operation.index
              break
            }
            record.operations[operation.index] = {
              failureIndexes: [],
              index: operation.index,
              key: operation.key,
              mode: operation.final ? 'final' : 'return-required',
              status: 'returned',
              args: observedArgs,
              value: diagnostic(rawValue),
            }
            enter('checkpoint')
            if (timer.overdue() || lifecycle.reason !== null) throw new CaseFailed()
            await stepsContract.step(operation.index, rawValue)
          }
          if (outcomeKind === 'return' && plan.final === null)
            rawValue =
              plan.output instanceof RuntimeReference
                ? stepsContract.argument(plan.output)
                : Object.fromEntries(
                    Object.entries(plan.output).map(([key, ref]) => [key, stepsContract.argument(ref)]),
                  )
        } else {
          const target = resolvedTarget
          if (target === null || target.kind === 'scenario') throw new TypeError('scenario cases require steps')
          try {
            rawValue = valueOf(
              await (target.kind === 'method'
                ? invoke(target.fn, target.object, args)
                : invoke(target.fn, undefined, args)),
            )
          } catch (error) {
            rawValue = valueOf(error)
            outcomeKind = 'throw'
          }
        }
        const outcome: TargetOutcome = { kind: outcomeKind, value: diagnostic(rawValue) }
        record.outcome = outcome
        if (timer.overdue() || lifecycle.reason !== null) throw new CaseFailed()
        if (contract) {
          enter('observe')
          await contract.after(outcomeKind, rawValue, prefixFailure === null)
          const wanted = prefixFailure === null ? contract.compiled.termination : 'return'
          if (wanted !== 'return-or-throw' && wanted !== outcomeKind)
            record.failures.push(
              failure('outcome', 'target', 'unexpected target outcome', {
                expected: wanted,
                actual: outcome,
                ...(plan === null ? {} : { operationIndex: prefixFailure ?? plan.final?.index }),
              }),
            )
          enter('assert')
          const evaluated = contractReport(contract)
          record.failures.push(...evaluated.failures)
          record.assertions.push(...evaluated.assertions)
        }
        if (record.failures.length) throw new CaseFailed()
      } catch (error) {
        const phase = timer.stage
        if (!(error instanceof CaseFailed))
          pendingFailure = faultToFailure(
            error instanceof CaptureFailure && error.causes.length === 1 ? error.causes[0] : error,
            phase,
          )
        let remaining: readonly Value[] = error instanceof CaptureFailure ? error.causes : [valueOf(error)]
        if (error instanceof CaptureFailure && contract && startedTarget) {
          enter('observe')
          await contract.after(null, undefined, false)
        }
        if (contract !== undefined && record.assertions.length === 0 && (timer.overdue() || lifecycle.reason !== null))
          record.assertions.push(
            ...pendingAssertions(
              contract,
              timer.overdue() ? `evaluation timed out during ${phase}` : 'evaluation was cancelled',
            ),
          )
        if (contract !== undefined && record.assertions.length === 0) {
          const evaluated = contractReport(
            contract,
            error instanceof CaptureFailure ? { causes: error.causes, phase } : undefined,
          )
          record.assertions.push(...evaluated.assertions)
          record.failures.push(...evaluated.failures)
          if (error instanceof CaptureFailure)
            remaining = remaining.filter((cause) => !evaluated.reportedCauses.includes(cause))
        }
        if (error instanceof CaptureFailure)
          pendingFailure = remaining.length
            ? faultToFailure(remaining.length === 1 ? remaining[0] : new CaptureFailure(remaining), phase)
            : undefined
        failed = true
        originalError =
          error instanceof CaseFailed || remaining.length === 0
            ? new CaseFailed()
            : new EvaluationFault(remaining.length === 1 ? remaining[0] : new CaptureFailure(remaining), phase)
      }
      enter('cleanup')
      const observationErrors = contract ? await contract.close() : []
      const errors = [...observationErrors]
      if (errors.length) throw new CleanupFault(failed ? [originalError, ...errors] : errors)
      if (failed) throw originalError
    }
    const runFrame = async (index: number, ctx: Fields): Promise<void> => {
      if (timer.overdue()) return
      if (index === node.frames.length) return core(Object.freeze(ctx))
      const frame = node.frames[index]
      const walkSteps = async (stepIndex: number, current: Fields): Promise<void> => {
        if (stepIndex === frame.steps.length) return runFrame(index + 1, { ...current, ...frame.fields })
        return withMiddleware(
          frame.steps[stepIndex],
          Object.freeze(current),
          (fields) => walkSteps(stepIndex + 1, { ...current, ...fields }),
          () => lifecycle.timedOut(),
          undefined,
          undefined,
          owner,
        )
      }
      return walkSteps(0, ctx)
    }
    try {
      await runFrame(0, {})
    } catch (error) {
      const fault = classifyAttemptError(valueOf(error), timer.stage)
      record.failures.push(...fault.failures)
      record.cleanup = fault.cleanup
      record.retryable = fault.retryable
      // タイムアウトはrunを打ち切る理由として強く、後処理の失敗で上書きしない。
      if (fault.abort && lifecycle.reason !== 'timeout') lifecycle.abort(fault.abort)
    } finally {
      owner.close()
    }
    const overdue = timer.overdue()
    if (overdue) {
      lifecycle.abort('timeout')
      record.failures.push(
        failure('timeout', overdue.stage, `attempt exceeded ${config.timeout}ms`, {
          timeoutMs: config.timeout,
          cleanup: record.cleanup,
        }),
      )
    }
    if (record.failures.some((x) => x.kind === 'timeout')) lifecycle.abort('timeout')
    const result = finalizeAttempt(record, number, now() - started, lifecycle.reason)
    if (sample === null)
      result.evaluations = [
        {
          kind: 'example',
          sampleIndex: null,
          input: record.input ?? { kind: 'omitted', reason: 'input was not bound' },
          operations: record.operations,
          expectedTermination: record.expectedTermination,
          terminationTarget: record.terminationTarget,
          status: result.status,
          outcome: result.outcome,
          assertions: result.assertions,
          failureIndexes: result.failures.map((_, index) => index),
          cleanup: result.cleanup,
        },
      ]
    return {
      result: withFailureReferences(result),
      retryable: record.retryable,
    }
  }
}
