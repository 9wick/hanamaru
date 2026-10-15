import { Config } from '@zeltjs/core'

import type { Config as ProjectConfig } from '../collection/config.js'
import type { CliOptions } from '../collection/options.js'

/** 実行場所を基準にしたファイルの読み取り。探索・設定・表示名のどれも同じ基準に従う。 */
@Config({ abstract: true })
export abstract class ProjectFiles {
  abstract resolve(file: string): string
  abstract glob(pattern: string): string[]
  abstract relative(file: string): string
  abstract readConfig(options: CliOptions, onLoading: (file: string) => void): Promise<ProjectConfig>
}

/** 人へ向けた警告の行き先。結果表示の通り道とは分ける。 */
@Config({ abstract: true })
export abstract class Warnings {
  abstract warn(message: string): void
}
