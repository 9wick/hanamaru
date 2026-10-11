/** 公開APIの型。内部実装とともに型検査し、パッケージへ配布する。 */
export type AnyFn = (...args: never[]) => void

export type FnKeys<O> = Extract<
  {
    [K in keyof O]-?: O[K] extends AnyFn ? K : never
  }[keyof O],
  string
>

export type MethodOf<O, K extends keyof O> = Extract<O[K], AnyFn>
