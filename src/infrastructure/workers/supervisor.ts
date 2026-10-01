import { Worker } from 'node:worker_threads'
import * as v from 'valibot'
import { ProgressStore } from '../../application/execution/progress.js'
import type { CollectionRequest, ReportResult } from '../../application/ports/collection-runner.js'
import type { MutableRunResult } from '../../domain/result/mutable.js'
import { cliMessageSchema } from './schemas.js'

/**
 * 収集の期限・実行の期限・終了の猶予を測る3本のタイマー。
 * 猶予はいちばん先に決まった理由で1度だけ始める。あとから別の理由が来ても測り直さない。
 */
class ShutdownTimers {
  #loading: ReturnType<typeof setTimeout> | undefined
  #deadline: ReturnType<typeof setTimeout> | undefined
  #grace: ReturnType<typeof setTimeout> | undefined

  restartLoading(timeoutMs: number, onExpire: () => void): void {
    clearTimeout(this.#loading)
    this.#loading = setTimeout(onExpire, timeoutMs)
  }

  clearLoading(): void {
    clearTimeout(this.#loading)
    this.#loading = undefined
  }

  restartDeadline(timeoutMs: number, onExpire: () => void): void {
    clearTimeout(this.#deadline)
    this.#deadline = setTimeout(onExpire, timeoutMs)
  }

  clearDeadline(): void {
    clearTimeout(this.#deadline)
    this.#deadline = undefined
  }

  startGrace(graceMs: number, onExpire: () => void): void {
    if (this.#grace) return
    this.#grace = setTimeout(onExpire, graceMs)
  }

  clearAll(): void {
    this.clearLoading()
    this.clearDeadline()
    clearTimeout(this.#grace)
    this.#grace = undefined
  }
}

/** 監督の進み具合。中断された事実は終了コードを決めるまで残す。 */
type SupervisorPhase = { kind: 'running' } | { kind: 'interrupted' } | { kind: 'complete' }

/** 中断された実行は、停止の理由にかかわらず130で終わる。 */
function exitCode(phase: SupervisorPhase, code: number): number {
  return phase.kind === 'interrupted' ? 130 : code
}

/** workerが実行に入った時点で確定する終了の作法。 */
interface ShutdownPolicy {
  graceMs: number
  reporter: string | undefined
}

export async function superviseCollection(
  workerURL: URL,
  { options, files }: CollectionRequest,
  report: ReportResult,
): Promise<number> {
  const worker = new Worker(workerURL, { workerData: { options, files } })
  const timers = new ShutdownTimers()
  const progress = new ProgressStore()
  let phase: SupervisorPhase = { kind: 'running' }
  let policy: ShutdownPolicy = { graceMs: 1_000, reporter: options.reporter }
  const done = new Promise<number>((resolve, reject) => {
    const printResult = (result: MutableRunResult) => report(result, policy.reporter)
    const finish = (code: number) => {
      if (phase.kind === 'complete') return
      phase = { kind: 'complete' }
      timers.clearAll()
      process.off('SIGINT', interrupt)
      worker.terminate().then(() => resolve(code), reject)
    }
    // 猶予を使い切ったら、手元の部分結果を出してから降りる。
    const reportAfterGrace = (code: number) => {
      timers.startGrace(policy.graceMs, () => {
        process.stderr.write(`hanamaru: shutdown grace exceeded (${policy.graceMs}ms)\n`)
        if (progress.result) printResult(progress.result)
        finish(exitCode(phase, code))
      })
    }
    const interrupt = () => {
      phase = { kind: 'interrupted' }
      process.stderr.write('hanamaru: interrupted\n')
      worker.postMessage({ type: 'interrupt' })
      timers.startGrace(policy.graceMs, () => {
        if (progress.result)
          printResult({
            ...progress.result,
            status: progress.result.status === 'failed' ? 'failed' : 'cancelled',
            reason: 'interrupted',
          })
        finish(130)
      })
    }
    process.on('SIGINT', interrupt)
    worker.on('message', (input) => {
      if (phase.kind === 'complete') return
      const parsed = v.safeParse(cliMessageSchema, input)
      if (!parsed.success) {
        process.stderr.write(`hanamaru: invalid worker message: ${v.summarize(parsed.issues)}\n`)
        finish(exitCode(phase, 2))
        return
      }
      const message = parsed.output
      if (message.type === 'loading') {
        timers.restartLoading(message.timeout, () => {
          process.stderr.write(`hanamaru: collection timeout: ${message.file} (${message.timeout}ms)\n`)
          finish(exitCode(phase, 2))
        })
      } else if (message.type === 'running') {
        timers.clearLoading()
        policy = { graceMs: message.shutdownGrace, reporter: message.reporter }
      } else if (message.type === 'progress') {
        progress.apply(message.progress)
      } else if (message.type === 'deadline') {
        if (message.kind === 'end') timers.clearDeadline()
        else
          timers.restartDeadline(message.timeoutMs, () => {
            progress.apply(message.progress)
            if (progress.result) {
              progress.result.status = 'failed'
              progress.result.reason = 'timeout'
            }
            reportAfterGrace(1)
          })
      } else if (message.type === 'timeout') {
        timers.clearDeadline()
        progress.apply({ kind: 'init', result: message.result })
        reportAfterGrace(1)
      } else if (message.type === 'result') {
        policy = { ...policy, reporter: message.reporter }
        printResult(message.result)
        finish(exitCode(phase, message.result.status === 'passed' ? 0 : 1))
      } else if (message.type === 'error') {
        process.stderr.write(`hanamaru: ${message.message}\n`)
        finish(exitCode(phase, 2))
      }
    })
    worker.on('error', (error) => {
      process.stderr.write(`hanamaru: ${error.stack ?? error}\n`)
      finish(exitCode(phase, 2))
    })
    worker.on('exit', (code) => {
      if (phase.kind !== 'complete') {
        process.stderr.write(`hanamaru: worker exited (${code})\n`)
        finish(exitCode(phase, 2))
      }
    })
  })
  return done
}
