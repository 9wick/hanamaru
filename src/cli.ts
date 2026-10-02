import { Config, createApp } from '@zeltjs/core'
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

try {
  // 1回のCLI起動が1回のscope。引数の解釈より先に組み立て、起こしたworkerの後片付けまで同じscopeで持つ。
  const scope = await createApp([]).createRuntime({
    configs: [ProcessEnvironment, PackageRelease, StdoutPresenter, CollectionSupervisor],
  })
  try {
    process.exitCode = await (await scope.get(CliCommand)).run(process.argv.slice(2))
  } finally {
    await scope.shutdown()
  }
} catch (error) {
  process.stderr.write(`hanamaru: ${errorMessage(error)}\n`)
  process.exitCode = 2
}
