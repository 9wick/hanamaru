import { Config } from '@zeltjs/core'
import { createTestTarget } from '@zeltjs/testing/vitest'
import { Worker } from 'node:worker_threads'
import { expect, onTestFinished, test, vi } from 'vite-plus/test'
import { ResultPresenter } from '../../application/ports/collection-runner.js'
import { CliEnvironment } from './environment.js'
import { CollectionSupervisor } from './supervisor.js'

const result = { version: 1, status: 'passed', reason: 'completed', tests: [] }
const imports = "import { parentPort, workerData } from 'node:worker_threads'\n"
const collect = `
workerData.executionPort.on('message', message => {
  if (message.type === 'ready') parentPort.postMessage({ type: 'close-execution' })
})
parentPort.on('message', message => {
  if (message.type === 'execution-closed') parentPort.postMessage({ type: 'result', reporter: 'json', result: ${JSON.stringify(result)} })
})
`
const execute = `
workerData.port.on('message', () => {})
workerData.port.postMessage({ type: 'ready' })
`

function workerURL(source: string): URL {
  return new URL(`data:text/javascript,${encodeURIComponent(imports + source)}`)
}

async function supervisor(collectionSource = collect, executionURL = workerURL(execute)) {
  @Config()
  class Environment extends CliEnvironment {
    readonly collectionWorkerURL = workerURL(collectionSource)
    readonly executionWorkerURL = executionURL
  }
  @Config()
  class Presenter extends ResultPresenter {
    override readonly present = vi.fn()
  }
  const { target: runner, get } = await createTestTarget(CollectionSupervisor, {
    configs: [Environment, Presenter, CollectionSupervisor],
  })
  return { runner, presenter: await get(Presenter) }
}

test('the CLI owns both peer workers and acknowledges termination before reporting the result', async () => {
  const terminated = vi.spyOn(Worker.prototype, 'terminate')
  onTestFinished(() => terminated.mockRestore())
  const { runner, presenter } = await supervisor()
  expect(await runner.run({ files: [], options: {} })).toBe(0)
  expect(presenter.present).toHaveBeenCalledExactlyOnceWith(result, 'json')
  expect(terminated).toHaveBeenCalledTimes(2)
})

test('an exit emitted synchronously by terminate is an expected shutdown', async () => {
  const original = Worker.prototype.terminate
  const terminated = vi.spyOn(Worker.prototype, 'terminate').mockImplementation(function (this: Worker) {
    this.emit('exit', 1)
    return original.call(this)
  })
  onTestFinished(() => terminated.mockRestore())
  const { runner } = await supervisor()
  expect(await runner.run({ files: [], options: {} })).toBe(0)
  expect(terminated).toHaveBeenCalledTimes(2)
})

test.each([
  ['collection', "throw new Error('broken collection bootstrap')", workerURL(execute)],
  ['execution', collect, workerURL("throw new Error('broken execution bootstrap')")],
  ['execution exit', collect, workerURL('process.exit(7)')],
])('%s failure stops both workers without inventing a result', async (_, source, url) => {
  const terminated = vi.spyOn(Worker.prototype, 'terminate')
  onTestFinished(() => terminated.mockRestore())
  const { runner, presenter } = await supervisor(source, url)
  expect(await runner.run({ files: [], options: {} })).toBe(2)
  expect(presenter.present).not.toHaveBeenCalled()
  expect(terminated).toHaveBeenCalledTimes(2)
})

test('a collection timeout stops both workers even when both threads are blocked', async () => {
  const terminated = vi.spyOn(Worker.prototype, 'terminate')
  onTestFinished(() => terminated.mockRestore())
  const { runner, presenter } = await supervisor(
    "parentPort.postMessage({ type: 'loading', file: 'blocked', timeout: 20 }); while (true) {}",
    workerURL('while (true) {}'),
  )
  expect(await runner.run({ files: [], options: {} })).toBe(2)
  expect(presenter.present).not.toHaveBeenCalled()
  expect(terminated).toHaveBeenCalledTimes(2)
})

test('a synchronous failure to create execution stops the already created collection worker', async () => {
  const terminated = vi.spyOn(Worker.prototype, 'terminate')
  onTestFinished(() => terminated.mockRestore())
  const { runner } = await supervisor('setInterval(() => {}, 1000)', new URL('https://invalid.example/worker.js'))
  await expect(runner.run({ files: [], options: {} })).rejects.toThrow()
  expect(terminated).toHaveBeenCalledTimes(1)
})
