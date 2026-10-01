import { parentPort, workerData as rawWorkerData } from 'node:worker_threads'
import * as v from 'valibot'
import { AttemptExecutor } from '../../application/execution/attempt.js'
import { GroupMiddlewareExecutor } from '../../application/execution/middleware.js'
import { CallBinder } from '../../application/execution/services.js'
import * as comparison from '../comparison.js'
import { FacadeEvaluator } from '../modules/evaluator.js'
import { ModuleFacades } from '../modules/facades.js'
import { ModuleRegistry } from '../modules/reference.js'
import { FacadeRunner } from '../modules/runner.js'
import { ModuleRuntime } from '../modules/runtime.js'
import { ExecutionChannel } from './execution-channel.js'
import { ExecutionLoader } from './execution-loader.js'
import { ExecutionServer } from './execution-server.js'
import { ExecutionSession } from './execution-session.js'
import { executionWorkerDataSchema } from './schemas.js'
import { StderrLog } from './stderr-log.js'

if (!parentPort) throw new Error('execution requires a worker thread')

new StderrLog().captureConsole()

const channel = new ExecutionChannel(parentPort)

const workerData = v.parse(executionWorkerDataSchema, rawWorkerData)

const session = new ExecutionSession(channel)

// module runtimeと計画の指紋は同じnamespaceの出自を見なければ噛み合わない。
const registry = new ModuleRegistry()

const facades = new ModuleFacades(registry, workerData.preparation)

const runtime = new ModuleRuntime(new FacadeRunner(facades, new FacadeEvaluator(facades), session.compiles), facades)

// call期待の繋ぎ直しはmodule runtimeに頼るため、実行の一式はruntimeができてから組み立てる。
const attempts = new AttemptExecutor(comparison, session.tracker, session.events, new CallBinder(runtime.bindCall))

const server = new ExecutionServer(
  session.commands,
  session.tracker,
  attempts,
  new GroupMiddlewareExecutor(session.tracker, session.events),
  runtime,
  channel,
)

const loader = new ExecutionLoader(runtime, registry, channel)

channel.onMessage((message) => {
  if (!session.receive(message)) channel.fail(new Error('unexpected module compilation reply'))
})

// 読み込みが終わるまでcommandは溜めておき、走らせられる形が揃ってからreadyを返す。
loader
  .load(workerData)
  .then((nodes) => {
    channel.ready()
    server.serve(nodes).catch((error: unknown) => channel.fail(error))
  })
  .catch((error: unknown) => channel.fail(error))
