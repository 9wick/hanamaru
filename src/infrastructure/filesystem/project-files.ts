import { globSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import type { Config } from '../../application/collection/config.js'
import type { CliOptions } from '../../application/collection/options.js'
import type { ProjectFiles } from '../../application/ports/collection-host.js'
import { readConfig } from './config.js'

/** 実行場所(process.cwd())を基準にしたファイルの読み取り。探索・設定・表示名が同じ基準を見る。 */
export class ProjectFilesystem implements ProjectFiles {
  resolve(file: string): string {
    return resolve(file)
  }

  glob(pattern: string): string[] {
    return [...globSync(pattern, { cwd: process.cwd() })]
  }

  relative(file: string): string {
    return relative(process.cwd(), file)
  }

  readConfig(options: CliOptions, onLoading: (file: string) => void): Promise<Config> {
    return readConfig(options, onLoading)
  }
}
