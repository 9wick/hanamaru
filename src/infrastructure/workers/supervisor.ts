import { Worker } from 'node:worker_threads'
import * as v from 'valibot'
import { ProgressStore } from '../../application/execution/progress.js'
import type { CollectionRequest, ReportResult } from '../../application/ports/collection-runner.js'
import type { MutableRunResult } from '../../domain/result/mutable.js'
import { cliMessageSchema } from './schemas.js'
export async function superviseCollection(
  workerURL: URL,
  { options, files }: CollectionRequest,
  report: ReportResult,
): Promise<number> {
  const worker = new Worker(workerURL, { workerData: { options, files } })
  let loadingTimer: ReturnType<typeof setTimeout> | undefined
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  let grace = 1_000,
    complete = false,
    interrupted = false,
    reporter = options.reporter
  const progress = new ProgressStore()
  const done = new Promise<number>((resolve, reject) => {
    const printResult = (result: MutableRunResult) => report(result, reporter)
    const finish = (code: number) => {
      if (complete) return
      complete = true
      clearTimeout(loadingTimer)
      clearTimeout(deadlineTimer)
      clearTimeout(graceTimer)
      process.off('SIGINT', interrupt)
      worker.terminate().then(() => resolve(code), reject)
    }
    const interrupt = () => {
      interrupted = true
      process.stderr.write('hanamaru: interrupted\n')
      worker.postMessage({ type: 'interrupt' })
      if (!graceTimer)
        graceTimer = setTimeout(() => {
          if (progress.result)
            printResult({
              ...progress.result,
              status: progress.result.status === 'failed' ? 'failed' : 'cancelled',
              reason: 'interrupted',
            })
          finish(130)
        }, grace)
    }
    process.on('SIGINT', interrupt)
    worker.on('message', (input) => {
      if (complete) return
      const parsed = v.safeParse(cliMessageSchema, input)
      if (!parsed.success) {
        process.stderr.write(`hanamaru: invalid worker message: ${v.summarize(parsed.issues)}\n`)
        finish(interrupted ? 130 : 2)
        return
      }
      const message = parsed.output
      if (message.type === 'loading') {
        clearTimeout(loadingTimer)
        loadingTimer = setTimeout(() => {
          process.stderr.write(`hanamaru: collection timeout: ${message.file} (${message.timeout}ms)\n`)
          finish(interrupted ? 130 : 2)
        }, message.timeout)
      } else if (message.type === 'running') {
        clearTimeout(loadingTimer)
        grace = message.shutdownGrace
        reporter = message.reporter
      } else if (message.type === 'progress') {
        progress.apply(message.progress)
      } else if (message.type === 'deadline') {
        clearTimeout(deadlineTimer)
        if (message.kind === 'start')
          deadlineTimer = setTimeout(() => {
            progress.apply(message.progress)
            if (progress.result) {
              progress.result.status = 'failed'
              progress.result.reason = 'timeout'
            }
            if (!graceTimer)
              graceTimer = setTimeout(() => {
                process.stderr.write(`hanamaru: shutdown grace exceeded (${grace}ms)\n`)
                if (progress.result) printResult(progress.result)
                finish(interrupted ? 130 : 1)
              }, grace)
          }, message.timeoutMs)
      } else if (message.type === 'timeout') {
        clearTimeout(deadlineTimer)
        progress.apply({ kind: 'init', result: message.result })
        if (!graceTimer)
          graceTimer = setTimeout(() => {
            process.stderr.write(`hanamaru: shutdown grace exceeded (${grace}ms)\n`)
            if (progress.result) printResult(progress.result)
            finish(interrupted ? 130 : 1)
          }, grace)
      } else if (message.type === 'result') {
        reporter = message.reporter
        printResult(message.result)
        finish(interrupted ? 130 : message.result.status === 'passed' ? 0 : 1)
      } else if (message.type === 'error') {
        process.stderr.write(`hanamaru: ${message.message}\n`)
        finish(interrupted ? 130 : 2)
      }
    })
    worker.on('error', (error) => {
      process.stderr.write(`hanamaru: ${error.stack ?? error}\n`)
      finish(interrupted ? 130 : 2)
    })
    worker.on('exit', (code) => {
      if (!complete) {
        process.stderr.write(`hanamaru: worker exited (${code})\n`)
        finish(interrupted ? 130 : 2)
      }
    })
  })
  return done
}
