import * as v from 'valibot'
import { required } from './value.js'
import { executionWorkerDataSchema, executionIncomingSchema } from './schemas.js'
import type { Value } from './value.js'
import type { ExecutionCommand, ExecutionMessage } from './protocol.js'
import type { AttemptState, ExecutionNode, Frame, Fields } from './internal.js'
import { errorStack } from './shared.js'
import { parentPort, workerData as rawWorkerData } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'
import { collectBlueprints, createPlan, executeAttempt, executeGroupMiddleware, failChildren } from './runner.js'
import { describeExecutionPlan, indexExecutionNodes } from './execution-plan.js'
import { createModuleRuntime } from './module-runtime.js'
import { registrationsIn, resetRegistrations } from './registration.js'

if (!parentPort) throw new Error('execution requires a worker thread')
const port = parentPort
const workerData = v.parse(executionWorkerDataSchema, rawWorkerData)
const consoleMethods: ('log' | 'info' | 'warn' | 'error' | 'debug')[] = ['log', 'info', 'warn', 'error', 'debug']
for (const method of consoleMethods)
  console[method] = (...values: Value[]) => process.stderr.write(values.map(String).join(' ') + '\n')
const send = (message: ExecutionMessage) => port.postMessage(message)
const compiling = new Map<number, { resolve: (value: Value) => void; reject: (error: Value) => void }>()
let nextCompileId = 0
const runtime = createModuleRuntime(
  (name, args) =>
    new Promise<Value>((resolve, reject) => {
      const id = nextCompileId++
      compiling.set(id, { resolve, reject })
      send({ type: 'compile', id, name, args })
    }),
  workerData.preparation,
)
const pending: ExecutionCommand[] = []
let waiting: ((command: ExecutionCommand) => void) | null = null
const state: AttemptState = {
  reason: null,
  activeAttempt: null,
  onTimeout: () => send({ type: 'timeout', phase: state.activeAttempt?.phase }),
}
port.on('message', (input) => {
  const message = v.parse(executionIncomingSchema, input)
  if (message.type === 'compiled') {
    const entry = compiling.get(message.id)
    if (!entry) return reportError(new Error('unexpected module compilation reply'))
    compiling.delete(message.id)
    if (message.error) entry.reject(new Error(message.error))
    else entry.resolve(message.result)
    return
  }
  if (message.type === 'interrupt') {
    if (state.reason !== 'timeout') state.reason = 'interrupted'
    return
  }
  if (waiting) {
    const resolve = waiting
    waiting = null
    resolve(message)
  } else pending.push(message)
})
function take(): Promise<ExecutionCommand> {
  if (pending.length) return Promise.resolve(required(pending.shift()))
  return new Promise<ExecutionCommand>((resolve) => {
    waiting = resolve
  })
}
interface ActiveGroup {
  path: number[]
  frameCount: number
  fields: Fields
}
function withGroups<N extends ExecutionNode>(node: N, groups: ActiveGroup[]): N {
  const frames: Frame[] = []
  const stable: Fields = {}
  for (const group of groups) Object.assign(stable, group.fields)
  node.frames.forEach((frame, index) => {
    frames.push(frame)
    for (const group of groups) if (group.frameCount === index + 1) frames.push({ steps: [], fields: group.fields })
  })
  return { ...node, frames, stable }
}
function reportError<T>(error: T) {
  send({ type: 'error', message: errorStack(error) })
  port.close()
}
async function startExecution() {
  try {
    resetRegistrations()
    const files = new Set<string>()
    const definitions: Value[] = []
    for (const root of workerData.roots) {
      if (!files.has(root.file)) {
        send({ type: 'loading', file: root.file })
        await runtime.import(pathToFileURL(root.file).href)
        files.add(root.file)
      }
      const registered = registrationsIn(root.file)[root.index]
      if (!registered) throw new TypeError('test registrations changed between collection and execution')
      if (JSON.stringify(registered.origin) !== JSON.stringify(root.origin))
        throw new TypeError('test registrations changed between collection and execution')
      definitions.push(registered.definition)
    }
    for (const file of files)
      if (registrationsIn(file).length !== workerData.roots.filter((root) => root.file === file).length)
        throw new TypeError('test registrations changed between collection and execution')
    const plan = createPlan(collectBlueprints(definitions))
    if (JSON.stringify(describeExecutionPlan(plan.allNodes)) !== workerData.shape)
      throw new TypeError('test definitions changed between collection and execution')
    const nodes = indexExecutionNodes(plan.allNodes)
    async function serve(groups: ActiveGroup[] = []): Promise<Extract<ExecutionCommand, { type: 'group-close' }>> {
      while (true) {
        const command = await take()
        if (command.type === 'group-close') {
          if (!groups.length || JSON.stringify(command.path) !== JSON.stringify(required(groups.at(-1)).path))
            throw new TypeError('group close does not match the active group')
          return command
        }
        const key = JSON.stringify(command.type === 'attempt' ? command.path.slice(0, -1) : command.path)
        const original = nodes.get(key)
        if (!original) throw new TypeError('execution job references an unknown path')
        const node = runtime.bindNode(withGroups(original, groups))
        if (command.type === 'attempt') {
          if (node.kind !== 'test') throw new TypeError('attempt requires a test node')
          const item = node.bp.cases[required(command.path.at(-1))]
          if (
            !item ||
            item.mode === 'skip' ||
            item.mode === 'todo' ||
            !Number.isSafeInteger(command.number) ||
            command.number < 1
          )
            throw new TypeError('invalid attempt job')
          state.activeAttempt = { phase: 'middleware' }
          const result = await executeAttempt(node, runtime.bindCase(item), command.number, state, runtime.bindCall)
          state.activeAttempt = null
          send({ type: 'reply', id: command.id, value: { ...result, reason: state.reason } })
        } else if (command.type === 'group-open') {
          if (node.kind !== 'group' || !node.bp.middleware) throw new TypeError('invalid group job')
          const closeState: { command?: Extract<ExecutionCommand, { type: 'group-close' }> } = {}
          const result = await executeGroupMiddleware(
            node,
            async (fields) => {
              send({ type: 'reply', id: command.id, value: { entered: true } })
              closeState.command = await serve([...groups, { path: command.path, frameCount: node.frameCount, fields }])
              if (closeState.command.failed) failChildren()
            },
            state,
            (stage, timeoutMs) => send({ type: 'group-stage', path: command.path, stage, timeoutMs }),
          )
          send({
            type: 'reply',
            id: closeState.command ? closeState.command.id : command.id,
            value: { ...result, entered: false },
          })
        } else throw new TypeError('unknown execution command')
      }
    }
    send({ type: 'ready' })
    serve().catch(reportError)
  } catch (error) {
    reportError(error)
  }
}
startExecution().catch(reportError)
