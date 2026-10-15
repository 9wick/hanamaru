export interface ExecutionConfig {
  readonly timeout?: number
  readonly retry?: number
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
