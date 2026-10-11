/** 読み込み・終了待ちの設定に使う、有限の正の期限。 */
export function positive<T>(value: T, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    throw new TypeError(`${name} must be a positive finite number`)
  return value
}
