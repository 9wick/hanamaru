import type { ExecutionOptions, ExecutionMessage, CommandInput, ReplyValue } from './protocol.js'
import type { RunState, Reason, MutableRunResult, Executor, AttemptReply, GroupReply } from './internal.js'
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
  const pending = new Map<number, { resolve: (value: ReplyValue) => void; reject: (error: unknown) => void }>()
  let nextId = 0
  let state: RunState | null = null
  let snapshot: ((reason: Reason) => MutableRunResult) | null = null
  let closing = false
  let fatal: unknown
  let readyResolve!: () => void
  let readyReject!: (error: unknown) => void
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  const fail = (error: unknown) => {
    fatal = error
    readyReject(error)
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
  worker.on('message', (message: ExecutionMessage) => {
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
    } else if (message.type === 'ready') readyResolve()
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
        state.onDeadline?.({ kind: 'start', timeoutMs: message.timeoutMs, result: snapshot('timeout') })
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
  type CommandReply<C extends CommandInput> = C['type'] extends 'attempt'
    ? AttemptReply
    : C['type'] extends 'group-open'
      ? GroupReply | { entered: true }
      : GroupReply
  const request = <C extends CommandInput>(command: C): Promise<CommandReply<C>> => {
    if (fatal) return Promise.reject(fatal)
    if (closing) return Promise.reject(new Error('execution worker is closed'))
    const id = nextId++
    return new Promise<CommandReply<C>>((resolve, reject) => {
      pending.set(id, { resolve: (value) => resolve(value as CommandReply<C>), reject })
      worker.postMessage({ ...command, id })
    })
  }
  return {
    attach(runState, snapshotRun) {
      state = runState
      snapshot = snapshotRun
    },
    attempt: (path, number) => request({ type: 'attempt', path, number }),
    async group(path, body) {
      const opened = await request({ type: 'group-open', path })
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
      if (bodyFailed) throw bodyError
      return result
    },
    close,
  }
}
