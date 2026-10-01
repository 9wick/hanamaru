import type { ConfigClass, Lifecycle } from '@zeltjs/core'
import { Config, createApp, inject, LifecycleManager } from '@zeltjs/core'
import { expect, test } from 'vite-plus/test'
import { Test } from '../../index.js'
import type { RuntimeDefinitionHandle } from '../../domain/definition/runtime.js'
import type { ExecutionNode } from '../../domain/execution/model.js'
import type { Value } from '../../foundation/value.js'
import { ValueComparison } from '../../infrastructure/comparison.js'
import { collectBlueprints } from '../../interfaces/library/run.js'
import { DirectCalls } from '../execution/services.js'
import { ModuleToolchain, ProjectFiles, Warnings } from '../ports/collection-host.js'
import type { CollectionRequest } from '../ports/collection-runner.js'
import type { AttemptReply, ExecutionServices, ExecutionSpec, GroupReply } from '../ports/executor.js'
import { ExecutionPlace, Executor } from '../ports/executor.js'
import type { CliOptions } from './options.js'
import type { Config as ProjectConfig } from './config.js'
import { recordCollectionEvent } from './current-scope.js'
import type { CliMessage } from './events.js'
import { CollectionSink } from './events.js'
import { CollectionSession } from './session.js'

function definition(): RuntimeDefinitionHandle {
  const suite = new Test().target((n: number) => n).it('case', (t) => t.args(1).expect((e) => [e.result.toBe(1)]))
  const [blueprint] = collectBlueprints(suite)
  return { blueprint: () => blueprint }
}

interface Options {
  config?: ProjectConfig
  readConfig?: () => Promise<ProjectConfig>
  importFile?: (file: string) => void
  glob?: (pattern: string) => string[]
}

/**
 * 収集の外側だけを本物にした場。資源の開閉と送った通知の順序を観察する。
 * test runtimeの資源はscopeが持つため、解放はscopeを畳んだときに記録される。
 */
function harness(options: Options = {}) {
  const messages: string[] = []
  const closed: string[] = []
  const warnings: string[] = []

  @Config()
  class TestSink extends CollectionSink {
    post(event: CliMessage): void {
      if (event.type === 'loading') messages.push(`loading ${event.file} @${event.timeout}`)
      // スタック全文は固定しない。失敗の文脈は1行目に出る。
      else if (event.type === 'error') messages.push(`error ${event.message.split('\n')[0]}`)
      else messages.push(event.type)
    }
  }

  @Config()
  class TestFiles extends ProjectFiles {
    resolve(file: string): string {
      return file
    }
    relative(file: string): string {
      return `rel/${file}`
    }
    glob(pattern: string): string[] {
      return (options.glob ?? (() => []))(pattern)
    }
    async readConfig(_options: CliOptions, onLoading: (file: string) => void): Promise<ProjectConfig> {
      onLoading('hanamaru.config.ts')
      return options.readConfig ? options.readConfig() : (options.config ?? {})
    }
  }

  @Config()
  class TestWarnings extends Warnings {
    warn(message: string): void {
      warnings.push(message)
    }
  }

  @Config()
  class TestModules extends ModuleToolchain implements Lifecycle {
    #started = false

    constructor(lifecycle = inject(LifecycleManager)) {
      super()
      lifecycle.register(this)
    }
    startup(): void {}
    /** 開く前に畳まれたscopeでは閉じる相手がない。 */
    shutdown(): void {
      if (this.#started) closed.push('modules')
    }
    start(): Promise<void> {
      this.#started = true
      return Promise.resolve()
    }
    import(file: string): Promise<Value> {
      options.importFile?.(file)
      recordCollectionEvent({ kind: 'registered', definition: definition(), origin: { file, line: 1, column: 1 } })
      return Promise.resolve(undefined)
    }
    invoke(): Promise<Value> {
      return Promise.resolve(undefined)
    }
    prepare(): [] {
      return []
    }
    describe(_nodes: ExecutionNode[]): Value {
      return {}
    }
  }

  @Config()
  class TestExecutor extends Executor {
    start(_spec: ExecutionSpec, services: ExecutionServices): Promise<void> {
      services.onLoading('execution worker setup')
      return Promise.resolve()
    }
    attempt(_path: number[], number: number): Promise<AttemptReply> {
      return Promise.resolve({
        result: {
          attempt: number,
          status: 'passed',
          durationMs: 0,
          outcome: null,
          assertions: [],
          failures: [],
          cleanup: 'complete',
        },
        retryable: false,
      })
    }
    async group(_path: number[], body: () => Promise<boolean>): Promise<GroupReply> {
      await body()
      return { middleware: { status: 'passed', durationMs: 0, failures: [], cleanup: 'complete' }, reason: null }
    }
    close(): Promise<void> {
      closed.push('execution')
      return Promise.resolve()
    }
  }

  @Config()
  class TestPlace extends ExecutionPlace {
    readonly executor: Executor

    constructor(executor = inject(Executor)) {
      super()
      this.executor = executor
    }
  }

  const configs: ConfigClass<object>[] = [
    TestSink,
    TestFiles,
    TestWarnings,
    TestModules,
    TestExecutor,
    TestPlace,
    ValueComparison,
    DirectCalls,
  ]
  // 進捗と期限の通知は量が多く、収集の流れとは別に検証している。
  const flow = () => messages.filter((message) => message !== 'progress' && message !== 'deadline')
  return { configs, flow, closed, warnings }
}

/** 入口と同じ順序。1つのscopeが1回のrunを持ち、終わったら畳む。 */
async function collect(configs: ConfigClass<object>[], request: CollectionRequest) {
  const scope = await createApp([]).createRuntime({ configs })
  try {
    await (await scope.get(CollectionSession)).run(request, new AbortController().signal)
  } finally {
    await scope.shutdown()
  }
}

test('the config load has its own timeout and the rest uses the configured one', async () => {
  const { configs, flow, closed } = harness({ config: { collectionTimeout: 500 } })
  await collect(configs, { files: ['a.test.ts'], options: {} })
  expect(flow()).toStrictEqual([
    'loading hanamaru.config.ts @30000',
    'loading test runtime setup @500',
    'loading a.test.ts @500',
    'loading execution worker setup @500',
    'running',
    'result',
  ])
  expect(closed).toStrictEqual(['execution', 'modules'])
})

test('the command line timeout wins over the configured one, including the config load', async () => {
  const { configs, flow } = harness({ config: { collectionTimeout: 500 } })
  await collect(configs, { files: ['a.test.ts'], options: { collectionTimeout: 70 } })
  expect(flow()).toStrictEqual([
    'loading hanamaru.config.ts @70',
    'loading test runtime setup @70',
    'loading a.test.ts @70',
    'loading execution worker setup @70',
    'running',
    'result',
  ])
})

test('a failure while reading a test file names the file and its projects', async () => {
  const { configs, flow, closed } = harness({
    config: { projects: { unit: { include: ['*.test.ts'] } } },
    glob: () => ['a.test.ts'],
    importFile: () => {
      throw new TypeError('broken import')
    },
  })
  await collect(configs, { files: [], options: {} })
  expect(flow().at(-1)).toContain('error while collecting rel/a.test.ts (projects: unit): TypeError: broken import')
  expect(closed).toStrictEqual(['modules'])
})

test('a config that cannot be read stops before any resource is opened', async () => {
  const { configs, flow, closed } = harness({
    readConfig: () => Promise.reject(new Error('cannot load config: hanamaru.config.ts')),
  })
  await collect(configs, { files: ['a.test.ts'], options: {} })
  expect(flow()).toStrictEqual([
    'loading hanamaru.config.ts @30000',
    'error Error: cannot load config: hanamaru.config.ts',
  ])
  expect(closed).toStrictEqual([])
})

test('no matching test file stops before the test runtime is opened', async () => {
  const { configs, flow, closed } = harness()
  await collect(configs, { files: [], options: {} })
  expect(flow()).toStrictEqual(['loading hanamaru.config.ts @30000', 'error TypeError: no test files matched'])
  expect(closed).toStrictEqual([])
})

test('an invalid shutdown grace is reported before the test runtime is opened', async () => {
  const { configs, flow, closed } = harness({ config: { shutdownGrace: 0 } })
  await collect(configs, { files: ['a.test.ts'], options: {} })
  expect(flow().at(-1)).toContain('shutdownGrace')
  expect(closed).toStrictEqual([])
})
