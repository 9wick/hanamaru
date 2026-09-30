import { positive } from '../../domain/execution/config.js'
import type { Plan } from '../../domain/execution/model.js'
import type { MutableRunResult } from '../../domain/result/mutable.js'
import { errorStack } from '../../foundation/errors.js'
import { createPlan } from '../execution/plan.js'
import { runPlan } from '../execution/runner.js'
import type { InternalRunOptions } from '../execution/state.js'
import type { CollectionHost, CollectionRuntime, ModuleCompiler } from '../ports/collection-host.js'
import type { CollectionRequest } from '../ports/collection-runner.js'
import type { RootReference } from '../ports/module-loader.js'
import type { CliMessage } from './events.js'
import type { CollectedDefinition } from './registry.js'
import { collectBlueprints, registrationsIn, resetRegistrations } from './registry.js'
import type { SelectedFile } from './select-files.js'
import { selectFiles } from './select-files.js'
import { startDefinitionTracking, unregisteredDefinitions } from './tracking.js'
export async function collectAndRun(
  request: CollectionRequest,
  signal: AbortSignal,
  send: (event: CliMessage) => void,
  host: CollectionHost,
) {
  let compiler: ModuleCompiler | undefined
  let runtime: CollectionRuntime | undefined
  let collectingFile: SelectedFile | undefined
  try {
    const initialTimeout = request.options.collectionTimeout ?? 30_000
    positive(initialTimeout, 'collectionTimeout')
    const config = await host.readConfig(request.options, (file) =>
      send({ type: 'loading', file, timeout: initialTimeout }),
    )
    const timeout = request.options.collectionTimeout ?? config.collectionTimeout ?? 30_000
    const shutdownGrace = request.options.shutdownGrace ?? config.shutdownGrace ?? 1_000
    positive(timeout, 'collectionTimeout')
    positive(shutdownGrace, 'shutdownGrace')
    const reporter = request.options.reporter ?? config.reporter ?? 'pretty'
    if (reporter !== 'pretty' && reporter !== 'json') throw new TypeError('reporter must be pretty or json')
    const files = selectFiles(config, request, host)
    if (!files.length) throw new TypeError('no test files matched')
    send({ type: 'loading', file: 'test runtime setup', timeout })
    compiler = await host.createCompiler(config.vite)
    runtime = host.createRuntime(compiler.invoke)
    resetRegistrations()
    startDefinitionTracking()
    const definitions: CollectedDefinition[] = [],
      roots: RootReference[] = [],
      sources: { file: string; projects: string[] }[] = [],
      collected = new Set<object>()
    for (const { file, projects } of files) {
      collectingFile = { file, projects }
      send({ type: 'loading', file, timeout })
      await runtime.import(file)
      const registered = registrationsIn(file)
      if (!registered.length)
        throw new TypeError(
          `no tests registered in ${host.relative(file)}${projects.length ? ` (projects: ${projects.join(', ')})` : ''}`,
        )
      for (const [index, entry] of registered.entries()) {
        const definition = entry.definition
        if (collected.has(definition))
          throw new TypeError(
            `duplicate root definition: ${host.relative(file)}:${entry.origin.line}${projects.length ? ` (projects: ${projects.join(', ')})` : ''}`,
          )
        collected.add(definition)
        definitions.push(definition)
        roots.push({ file, index, origin: entry.origin })
        sources.push({ file: host.relative(file), projects })
      }
    }
    collectingFile = undefined
    for (const origin of unregisteredDefinitions(new Set(files.map(({ file }) => file)), collected))
      host.warn(
        `hanamaru: unregistered test definition: ${host.relative(origin.file)}:${origin.line}:${origin.column}\n`,
      )
    let plan: Plan
    const withSources = (result: MutableRunResult): MutableRunResult => ({
      ...result,
      tests: result.tests.map((node) => ({
        ...node,
        source: sources[plan.allNodes[node.path[0]].rootIndex],
      })),
    })
    const options: InternalRunOptions = {
      forbidOnly: request.options.ci,
      failOnFlaky: request.options.failOnFlaky,
      filter: request.options.filter,
      signal,
      onProgress: (progress) =>
        send({
          type: 'progress',
          progress: progress.kind === 'init' ? { ...progress, result: withSources(progress.result) } : progress,
        }),
      onTimeout: (result) => send({ type: 'timeout', result: withSources(result) }),
      onDeadline: (deadline) =>
        send({
          type: 'deadline',
          ...deadline,
        }),
    }
    const blueprints = collectBlueprints(definitions)
    plan = createPlan(blueprints, options)
    const execution = await host.openExecution({
      roots,
      preparation: host.prepare(blueprints),
      shape: JSON.stringify(host.describe(plan.allNodes)),
      invoke: compiler.invoke,
      signal,
      onLoading: (file) => send({ type: 'loading', file, timeout }),
    })
    send({ type: 'running', reporter, shutdownGrace })
    let result
    try {
      result = await runPlan(plan, options, host.comparison, execution)
    } finally {
      await execution.close()
    }
    send({ type: 'result', result: withSources(result), reporter })
  } catch (error) {
    const context = collectingFile
      ? `while collecting ${host.relative(collectingFile.file)}${collectingFile.projects.length ? ` (projects: ${collectingFile.projects.join(', ')})` : ''}: `
      : ''
    send({ type: 'error', message: context + errorStack(error) })
  } finally {
    await runtime?.close()
    await compiler?.close()
  }
}
