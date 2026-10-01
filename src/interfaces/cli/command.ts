import { Config, Injectable, inject } from '@zeltjs/core'
import { CollectionRunner } from '../../application/ports/collection-runner.js'
import { parseArgs } from './args.js'

/** 自分自身の版。配布物のpackage.jsonから読むため、起動ファイルだけがこれを知る。 */
@Config({ abstract: true })
export abstract class CliRelease {
  abstract readonly version: string
}

/** 引数を解釈して、その場で答えられるものを答え、残りを収集へ渡す入口。 */
@Injectable()
export class CliCommand {
  readonly #release: CliRelease
  readonly #runner: CollectionRunner

  constructor(release = inject(CliRelease), runner = inject(CollectionRunner)) {
    this.#release = release
    this.#runner = runner
  }

  run(argv: string[]): Promise<number> | number {
    const { options, files } = parseArgs(argv)
    if (options.version) {
      process.stdout.write(`${this.#release.version}\n`)
      return 0
    }
    if (options.help) {
      process.stdout.write(
        'hanamaru [files...] [--project name] [--filter text] [--reporter pretty|json] [--config file] [--ci] [--fail-on-flaky] [--collection-timeout ms] [--shutdown-grace ms]\n',
      )
      return 0
    }

    return this.#runner.run({ options, files })
  }
}
