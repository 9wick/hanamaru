import * as v from 'valibot'
import { required } from './value.js'
import { executionMessageSchema } from './schemas.js'
import type { Value } from './value.js'
import type { ExecutionOptions, CommandInput, ReplyValue } from './protocol.js'
import type { RunState, Reason, Progress, Executor } from './internal.js'
import { errorStack } from './shared.js'
import { Worker } from 'node:worker_threads'

export async function openExecution({
  roots,
  preparation,
  shape,
  signal,
  onLoading,
  invoke,
}: ExecutionOptions): Promise<Executor> {
  onLoading('execution worker setup')
  const worker = new Worker(new URL('./execution-worker.js', import.meta.url), {
    workerData: { role: 'execution', roots, preparation, shape },
  })
  const pending = new Map<number, { resolve: (value: ReplyValue) => void; reject: (error: Value) => void }>()
  let nextId = 0
  let state: RunState | null = null
  let snapshot: ((reason: Reason) => Progress) | null = null
  let closing = false
  let fatal: Value
  let readyResolve: (() => void) | undefined
  let readyReject: ((error: Value) => void) | undefined
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  const fail = (error: Value) => {
    fatal = error
    required(readyReject)(error)
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
  }
  const interrupt = () => worker.postMessage({ type: 'interrupt' })
  signal?.addEventListener('abort', interrupt)
  if (signal?.aborted) interrupt()
  worker.on('error', fail)
  worker.on('exit', (code) => {
    if (!closing) fail(new Error(`execution worker exited (${code})`))
  })
  worker.on('message', (input) => {
    const parsed = v.safeParse(executionMessageSchema, input)
    if (!parsed.success) return fail(new Error(`invalid execution message: ${v.summarize(parsed.issues)}`))
    const message = parsed.output
    if (message.type === 'compile') {
      invoke(message.name, message.args)
        .then(
          (result) => {
            if (!closing) worker.postMessage({ type: 'compiled', id: message.id, result })
          },
          (error) => {
            if (!closing) worker.postMessage({ type: 'compiled', id: message.id, error: errorStack(error) })
          },
        )
        .catch(fail)
    } else if (message.type === 'ready') required(readyResolve)()
    else if (message.type === 'loading') onLoading(message.file)
    else if (message.type === 'error') fail(new Error(message.message))
    else if (message.type === 'reply') {
      const entry = pending.get(message.id)
      if (!entry) {
        fail(new Error('unexpected execution reply'))
        return
      }
      pending.delete(message.id)
      if ('reason' in message.value && message.value.reason && state) state.reason = message.value.reason
      entry.resolve(message.value)
    } else if (message.type === 'timeout') {
      if (!state) return fail(new Error('execution state is not attached'))
      state.reason = 'timeout'
      if (state.activeAttempt && message.phase) state.activeAttempt.phase = message.phase
      state.onTimeout?.()
    } else if (message.type === 'group-stage') {
      if (!state || !snapshot) return fail(new Error('execution state is not attached'))
      if (message.stage === 'inside' || message.stage === 'end') state.onDeadline?.({ kind: 'end' })
      else {
        state.activeGroup = {
          path: message.path,
          stage: message.stage,
          started: performance.now(),
          timeoutMs: message.timeoutMs,
        }
        state.onDeadline?.({ kind: 'start', timeoutMs: message.timeoutMs, progress: snapshot('timeout') })
      }
    } else fail(new Error('unknown execution message'))
  })
  const close = async () => {
    closing = true
    signal?.removeEventListener('abort', interrupt)
    await worker.terminate()
  }
  try {
    await ready
  } catch (error) {
    await close()
    throw error
  }
  const request = (command: CommandInput): Promise<ReplyValue> => {
    if (fatal) return Promise.reject(fatal)
    if (closing) return Promise.reject(new Error('execution worker is closed'))
    const id = nextId++
    return new Promise<ReplyValue>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      worker.postMessage({ ...command, id })
    })
  }
  return {
    attach(runState, snapshotRun) {
      state = runState
      snapshot = snapshotRun
    },
    async attempt(path, number) {
      const reply = await request({ type: 'attempt', path, number })
      if (!('result' in reply)) throw new TypeError('unexpected attempt reply')
      return reply
    },
    async group(path, body) {
      const opened = await request({ type: 'group-open', path })
      if ('result' in opened) throw new TypeError('unexpected group reply')
      if (!opened.entered) return opened
      let failed = true
      let bodyError,
        bodyFailed = false
      try {
        failed = await body()
      } catch (error) {
        bodyFailed = true
        bodyError = error
      }
      const result = await request({ type: 'group-close', path, failed })
      if (!('middleware' in result)) throw new TypeError('unexpected group close reply')
      if (bodyFailed) throw bodyError
      return result
    },
    close,
  }
}
