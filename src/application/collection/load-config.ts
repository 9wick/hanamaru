import { positive } from '../../domain/execution/config.js'
import type { ProjectFiles } from '../ports/collection-host.js'
import type { Config } from './config.js'
import type { CliMessage } from './events.js'
import type { CliOptions } from './options.js'

/**
 * 設定ファイルの読み込み自体にも期限がある。設定はまだ読めていないため、引数の指定か既定値だけで測る。
 * 設定が決まってからの期限はCollectionSessionが測り直す。
 */
export async function loadConfig(
  options: CliOptions,
  files: ProjectFiles,
  send: (event: CliMessage) => void,
): Promise<Config> {
  const timeout = options.collectionTimeout ?? 30_000
  positive(timeout, 'collectionTimeout')
  return files.readConfig(options, (file) => send({ type: 'loading', file, timeout }))
}
