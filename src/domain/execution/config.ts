export interface ExecutionConfig {
  readonly timeout?: number
  readonly retry?: number
}

export interface ResolvedExecutionConfig {
  readonly timeout: number
  readonly retry: number
}

export function positive<T>(value: T, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    throw new TypeError(`${name} must be a positive finite number`)
  return value
}

export function retryCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('retry must be a nonnegative safe integer')
  return value
}

// 既定値は実行時の期限計算とdescribeExecutionPlanの指紋の両方が参照する。
// 片方だけリテラルを書き換えると指紋が一致したまま期限だけずれるため、1箇所に固定する。
export const defaultMiddlewareTimeoutMs = 10_000

export const defaultExecutionConfig: ResolvedExecutionConfig = Object.freeze({ timeout: 5_000, retry: 0 })

export function configWith(base: ResolvedExecutionConfig, own: ExecutionConfig): ResolvedExecutionConfig {
  return { timeout: own.timeout ?? base.timeout, retry: own.retry ?? base.retry }
}
