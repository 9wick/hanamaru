import { expect, test } from 'vite-plus/test'
import { Test } from '../../index.js'
import type { RuntimeDefinitionHandle } from '../../domain/definition/runtime.js'
import { errorStack } from '../../foundation/errors.js'
import * as comparison from '../../infrastructure/comparison.js'
import { collectBlueprints } from '../../interfaces/library/run.js'
import type { CollectionHost } from '../ports/collection-host.js'
import type { CollectionRequest } from '../ports/collection-runner.js'
import type { Config } from './config.js'
import { recordCollectionEvent } from './current-scope.js'
import type { CliMessage } from './events.js'
import { loadConfig } from './load-config.js'
import { CollectionSession } from './session.js'

function definition(): RuntimeDefinitionHandle {
  const suite = new Test().target((n: number) => n).it('case', (t) => t.args(1).expect((e) => [e.result.toBe(1)]))
  const [blueprint] = collectBlueprints(suite)
  return { blueprint: () => blueprint }
}

interface Options {
  config?: Config
  readConfig?: () => Promise<Config>
  importFile?: (file: string) => void
  glob?: (pattern: string) => string[]
}

/** 収集の外側だけを本物にした場。資源の開閉と送った通知の順序を観察する。 */
function harness(options: Options = {}) {
  const messages: string[] = []
  const closed: string[] = []
  const warnings: string[] = []
  const send = (event: CliMessage) => {
    if (event.type === 'loading') messages.push(`loading ${event.file} @${event.timeout}`)
    // スタック全文は固定しない。失敗の文脈は1行目に出る。
    else if (event.type === 'error') messages.push(`error ${event.message.split('\n')[0]}`)
    else messages.push(event.type)
  }
  const host: CollectionHost = {
    comparison,
    files: {
      resolve: (file) => file,
      relative: (file) => `rel/${file}`,
      glob: options.glob ?? (() => []),
      readConfig: async (_options, onLoading) => {
        onLoading('hanamaru.config.ts')
        return options.readConfig ? options.readConfig() : (options.config ?? {})
      },
    },
    modules: {
      createCompiler: async () => ({
        invoke: async () => undefined,
        close: async () => {
          closed.push('compiler')
        },
      }),
      createRuntime: () => ({
        import: async (file) => {
          options.importFile?.(file)
          recordCollectionEvent({ kind: 'registered', definition: definition(), origin: { file, line: 1, column: 1 } })
          return undefined
        },
        close: async () => {
          closed.push('runtime')
        },
      }),
      prepare: () => [],
      describe: () => ({}),
    },
    warn: (message) => warnings.push(message),
    openExecution: (_run, services) => ({
      start: async () => services.onLoading('execution worker setup'),
      attempt: async (_path, number) => ({
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
      }),
      group: async (_path, body) => {
        await body()
        return { middleware: { status: 'passed', durationMs: 0, failures: [], cleanup: 'complete' }, reason: null }
      },
      close: async () => {
        closed.push('execution')
      },
    }),
  }
  // 進捗と期限の通知は量が多く、収集の流れとは別に検証している。
  const flow = () => messages.filter((message) => message !== 'progress' && message !== 'deadline')
  return { host, send, flow, closed, warnings }
}

/** 入口と同じ順序。設定を読んでからsessionへ渡す。 */
async function collect(host: CollectionHost, send: (event: CliMessage) => void, request: CollectionRequest) {
  const session = new CollectionSession(host, send)
  try {
    const config = await loadConfig(request.options, host.files, send)
    await session.run(request, config, new AbortController().signal)
  } catch (error) {
    send({ type: 'error', message: errorStack(error) })
  }
}

test('the config load has its own timeout and the rest uses the configured one', async () => {
  const { host, send, flow, closed } = harness({ config: { collectionTimeout: 500 } })
  await collect(host, send, { files: ['a.test.ts'], options: {} })
  expect(flow()).toStrictEqual([
    'loading hanamaru.config.ts @30000',
    'loading test runtime setup @500',
    'loading a.test.ts @500',
    'loading execution worker setup @500',
    'running',
    'result',
  ])
  expect(closed).toStrictEqual(['execution', 'runtime', 'compiler'])
})

test('the command line timeout wins over the configured one, including the config load', async () => {
  const { host, send, flow } = harness({ config: { collectionTimeout: 500 } })
  await collect(host, send, { files: ['a.test.ts'], options: { collectionTimeout: 70 } })
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
  const { host, send, flow, closed } = harness({
    config: { projects: { unit: { include: ['*.test.ts'] } } },
    glob: () => ['a.test.ts'],
    importFile: () => {
      throw new TypeError('broken import')
    },
  })
  await collect(host, send, { files: [], options: {} })
  expect(flow().at(-1)).toContain('error while collecting rel/a.test.ts (projects: unit): TypeError: broken import')
  expect(closed).toStrictEqual(['runtime', 'compiler'])
})

test('a config that cannot be read stops before any resource is created', async () => {
  const { host, send, flow, closed } = harness({
    readConfig: () => Promise.reject(new Error('cannot load config: hanamaru.config.ts')),
  })
  await collect(host, send, { files: ['a.test.ts'], options: {} })
  expect(flow()).toStrictEqual([
    'loading hanamaru.config.ts @30000',
    'error Error: cannot load config: hanamaru.config.ts',
  ])
  expect(closed).toStrictEqual([])
})

test('no matching test file stops before the test runtime is created', async () => {
  const { host, send, flow, closed } = harness()
  await collect(host, send, { files: [], options: {} })
  expect(flow()).toStrictEqual(['loading hanamaru.config.ts @30000', 'error TypeError: no test files matched'])
  expect(closed).toStrictEqual([])
})

test('an invalid shutdown grace is reported before the test runtime is created', async () => {
  const { host, send, flow, closed } = harness({ config: { shutdownGrace: 0 } })
  await collect(host, send, { files: ['a.test.ts'], options: {} })
  expect(flow().at(-1)).toContain('shutdownGrace')
  expect(closed).toStrictEqual([])
})
