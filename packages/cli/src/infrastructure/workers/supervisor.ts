import { Config, inject } from '@zeltjs/core'
import { MessageChannel, Worker } from 'node:worker_threads'
import * as v from 'valibot'
import { ProgressStore } from '@hanamaru/execution/application/execution/progress'
import type { CollectionRequest } from '../../application/ports/collection-runner.js'
import { CollectionRunner, ResultPresenter } from '../../application/ports/collection-runner.js'
import type { MutableRunResult } from '@hanamaru/execution/domain/result/mutable'
import { CliEnvironment } from './environment.js'
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

/**
 * 収集workerと実行workerを起こして見張り、終了コードを決める。1回のCLI起動が1回の監督で、
 * 期限・猶予・中断された事実はその1回の中だけで意味を持つため、runの間だけ手元に置く。
 */
@Config()
export class CollectionSupervisor extends CollectionRunner {
  readonly #workerURL: URL
  readonly #executionWorkerURL: URL
  readonly #progress: ProgressStore
  readonly #presenter: ResultPresenter

  constructor(
    environment = inject(CliEnvironment),
    progress = inject(ProgressStore),
    presenter = inject(ResultPresenter),
  ) {
    super()
    this.#workerURL = environment.collectionWorkerURL
    this.#executionWorkerURL = environment.executionWorkerURL
    this.#progress = progress
    this.#presenter = presenter
  }

  async run({ options, files }: CollectionRequest): Promise<number> {
    const progress = this.#progress
    const { port1, port2 } = new MessageChannel()
    let worker: Worker | undefined
    let execution: Worker
    try {
      worker = new Worker(this.#workerURL, {
        workerData: { options, files, executionPort: port1 },
        transferList: [port1],
      })
      execution = new Worker(this.#executionWorkerURL, {
        workerData: { role: 'execution', port: port2 },
        transferList: [port2],
      })
    } catch (error) {
      // 片方の起動が同期的に失敗しても、既に起こしたworkerと未転送のportを残さない。
      port1.close()
      port2.close()
      await worker?.terminate()
      throw error
    }
    const collection = worker
    let executionClosing = false
    let stoppingExecution: Promise<number> | undefined
    const stopExecution = () => {
      // Denoはterminateの呼び出し中にもexitを通知するため、呼び出す前に正常な停止と確定する。
      executionClosing = true
      return (stoppingExecution ??= execution.terminate())
    }
    const timers = new ShutdownTimers()
    let phase: SupervisorPhase = { kind: 'running' }
    let policy: ShutdownPolicy = { graceMs: 1_000, reporter: options.reporter }
    return new Promise<number>((resolve, reject) => {
      const printResult = (result: MutableRunResult) => this.#presenter.present(result, policy.reporter)
      const finish = (code: number, forced = false) => {
        if (phase.kind === 'complete') return
        phase = { kind: 'complete' }
        timers.clearAll()
        process.off('SIGINT', interrupt)
        const stopped = Promise.all([collection.terminate(), stopExecution()])
        if (forced) {
          // 猶予切れではCLIを終了させる。同期ループ中のBunはterminateの完了を返せないため、
          // workerがプロセスを生かし続けないようにし、停止要求の完了を終了の条件にしない。
          collection.unref()
          execution.unref()
          stopped.catch((error: unknown) =>
            process.stderr.write(`hanamaru: worker shutdown failed: ${String(error)}\n`),
          )
          resolve(code)
        } else stopped.then(() => resolve(code), reject)
      }
      // 猶予を使い切ったら、手元の部分結果を出してから降りる。
      const reportAfterGrace = (code: number) => {
        timers.startGrace(policy.graceMs, () => {
          process.stderr.write(`hanamaru: shutdown grace exceeded (${policy.graceMs}ms)\n`)
          if (progress.result) printResult(progress.result)
          finish(exitCode(phase, code), true)
        })
      }
      const interrupt = () => {
        phase = { kind: 'interrupted' }
        process.stderr.write('hanamaru: interrupted\n')
        collection.postMessage({ type: 'interrupt' })
        timers.startGrace(policy.graceMs, () => {
          if (progress.result)
            printResult({
              ...progress.result,
              status: progress.result.status === 'failed' ? 'failed' : 'cancelled',
              reason: 'interrupted',
            })
          finish(130, true)
        })
      }
      process.on('SIGINT', interrupt)
      collection.on('message', (input) => {
        if (phase.kind === 'complete') return
        const parsed = v.safeParse(cliMessageSchema, input)
        if (!parsed.success) {
          process.stderr.write(`hanamaru: invalid worker message: ${v.summarize(parsed.issues)}\n`)
          finish(exitCode(phase, 2))
          return
        }
        const message = parsed.output
        if (message.type === 'close-execution') {
          stopExecution().then(
            () => {
              if (phase.kind !== 'complete') collection.postMessage({ type: 'execution-closed' })
            },
            (error: unknown) => {
              process.stderr.write(`hanamaru: execution worker shutdown failed: ${String(error)}\n`)
              finish(exitCode(phase, 2))
            },
          )
        } else if (message.type === 'loading') {
          timers.restartLoading(message.timeout, () => {
            process.stderr.write(`hanamaru: collection timeout: ${message.file} (${message.timeout}ms)\n`)
            finish(exitCode(phase, 2), true)
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
      collection.on('error', (error) => {
        process.stderr.write(`hanamaru: ${error.stack ?? error}\n`)
        finish(exitCode(phase, 2))
      })
      collection.on('exit', (code) => {
        if (phase.kind !== 'complete') {
          process.stderr.write(`hanamaru: worker exited (${code})\n`)
          finish(exitCode(phase, 2))
        }
      })
      execution.on('error', (error) => {
        if (phase.kind === 'complete') return
        process.stderr.write(`hanamaru: execution worker: ${error.stack ?? error}\n`)
        finish(exitCode(phase, 2))
      })
      execution.on('exit', (code) => {
        if (phase.kind !== 'complete' && !executionClosing) {
          process.stderr.write(`hanamaru: execution worker exited (${code})\n`)
          finish(exitCode(phase, 2))
        }
      })
    })
  }
}
