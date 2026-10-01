export interface RunOptions {
  readonly forbidOnly?: boolean
  readonly failOnFlaky?: boolean
}

/** 公開RunOptionsに内部だけが足す設定。値だけで、通知や中断の手段はサービスとして別に渡す。 */
export interface RunSettings extends RunOptions {
  readonly filter?: string
}
