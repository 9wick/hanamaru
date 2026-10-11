/** moduleのexportを呼び出すための関数の形。利用者のDSL型には依存しない。 */
export type AnyFn = (...args: never[]) => void
