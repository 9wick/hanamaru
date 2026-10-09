import { Injectable, inject } from '@zeltjs/core'
import { positive } from '../../domain/execution/config.js'
import { ProjectFiles } from '../ports/collection-host.js'
import type { CollectionRequest } from '../ports/collection-runner.js'
import type { Config } from './config.js'
import type { Reporter } from './events.js'
import { CollectionReporter } from './reporting.js'
import { selectFiles, type SelectedFile } from './select-files.js'

/** 設定が決まってから分かる期限・猶予・表示の形。引数の指定が設定より優先する。 */
export interface CollectionLimits {
  timeout: number
  shutdownGrace: number
  reporter: Reporter
}

function collectionLimits(options: CollectionRequest['options'], config: Config): CollectionLimits {
  const timeout = options.collectionTimeout ?? config.collectionTimeout ?? 30_000
  const shutdownGrace = options.shutdownGrace ?? config.shutdownGrace ?? 1_000
  positive(timeout, 'collectionTimeout')
  positive(shutdownGrace, 'shutdownGrace')
  const reporter = options.reporter ?? config.reporter ?? 'pretty'
  if (reporter !== 'pretty' && reporter !== 'json') throw new TypeError('reporter must be pretty or json')
  return { timeout, shutdownGrace, reporter }
}

export interface SelectedTestFiles {
  config: Config
  limits: CollectionLimits
  files: SelectedFile[]
}

/** 設定と引数から、読み込むファイルと収集の条件を決める。 */
@Injectable()
export class TestFileSelection {
  readonly #files: ProjectFiles
  readonly #reporter: CollectionReporter

  constructor(files = inject(ProjectFiles), reporter = inject(CollectionReporter)) {
    this.#files = files
    this.#reporter = reporter
  }

  async select(request: CollectionRequest): Promise<SelectedTestFiles> {
    const timeout = request.options.collectionTimeout ?? 30_000
    positive(timeout, 'collectionTimeout')
    const config = await this.#files.readConfig(request.options, (file) => this.#reporter.loading(file, timeout))
    const limits = collectionLimits(request.options, config)
    const files = selectFiles(config, request, this.#files)
    if (!files.length) throw new TypeError('no test files matched')
    return { config, limits, files }
  }
}
