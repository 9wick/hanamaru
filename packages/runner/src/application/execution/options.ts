import type { TargetSelection } from '../../domain/execution/targets.js'
export interface RunOptions {
  readonly forbidOnly?: boolean
  readonly failOnFlaky?: boolean
}

/** 登録後の選択と結果判定の条件。通知や中断の手段は保持しない。 */
export interface RunSettings extends RunOptions {
  readonly target?: TargetSelection
  readonly filter?: string
}

export interface ModuleOptions {
  readonly vite?: import('@hanamaru/vite').UserConfig
}
