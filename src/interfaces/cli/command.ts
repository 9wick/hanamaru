import { CliConfig, Command, Config, inject } from '@zeltjs/core'
import { CollectionRunner } from '../../application/ports/collection-runner.js'
import { parseArgs } from './args.js'

/** 自分自身の版。配布物のpackage.jsonから読むため、起動ファイルだけがこれを知る。 */
@Config({ abstract: true })
export abstract class CliRelease {
  abstract readonly version: string
}

/** 引数を解釈して、その場で答えられるものを答え、残りを収集へ渡す入口。 */
@Command({ name: 'run', description: 'Collect and run hanamaru tests' })
export class CliCommand {
  readonly #release: CliRelease
  readonly #runner: CollectionRunner
  readonly #environment: CliConfig

  constructor(release = inject(CliRelease), runner = inject(CollectionRunner), environment = inject(CliConfig)) {
    this.#release = release
    this.#runner = runner
    this.#environment = environment
  }

  async run(): Promise<void> {
    const { options, files } = parseArgs(this.#environment.argv().slice(2))
    if (options.version) {
      process.stdout.write(`${this.#release.version}\n`)
      this.#environment.setExitCode(0)
      return
    }
    if (options.help) {
      process.stdout.write(
        'hanamaru [files...] [--project name] [--filter text] [--reporter pretty|json] [--config file] [--ci] [--fail-on-flaky] [--collection-timeout ms] [--shutdown-grace ms]\n',
      )
      this.#environment.setExitCode(0)
      return
    }

    this.#environment.setExitCode(await this.#runner.run({ options, files }))
  }
}
