#!/usr/bin/env node
import { Config, command, createApp } from '@zeltjs/core'
import { onNode } from '@zeltjs/adapter-node'
import { readFileSync } from 'node:fs'
import * as v from 'valibot'
import { errorMessage } from './foundation/errors.js'
import { CliEnvironment } from './infrastructure/workers/environment.js'
import { CollectionSupervisor } from './infrastructure/workers/supervisor.js'
import { CliCommand, CliRelease } from './interfaces/cli/command.js'
import { StdoutPresenter } from './interfaces/cli/presenter.js'
const { version } = v.parse(
  v.object({ version: v.string() }),
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')),
)

@Config()
class ProcessEnvironment extends CliEnvironment {
  override readonly collectionWorkerURL = new URL('./cli-worker.js', import.meta.url)
  override readonly executionWorkerURL = new URL('./execution-worker.js', import.meta.url)
}

@Config()
class PackageRelease extends CliRelease {
  override readonly version = version
}

const app = createApp([command([CliCommand])], {
  configs: [ProcessEnvironment, PackageRelease, StdoutPresenter, CollectionSupervisor],
})

try {
  const nodeApp = await onNode(app)
  try {
    const result = await nodeApp.commands.execCommand(['run'])
    if (result.exitCode === 1) {
      process.stderr.write(`hanamaru: ${errorMessage(result.reason.cause ?? result.reason)}\n`)
      process.exitCode = 2
    }
  } finally {
    await nodeApp.shutdown()
  }
} catch (error) {
  process.stderr.write(`hanamaru: ${errorMessage(error)}\n`)
  process.exitCode = 2
}
