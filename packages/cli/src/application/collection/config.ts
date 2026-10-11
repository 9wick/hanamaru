export interface Config {
  readonly vite?: import('@hanamaru/vite').UserConfig
  readonly projects?: Readonly<
    Record<string, { readonly include: readonly string[]; readonly exclude?: readonly string[] }>
  >
  readonly reporter?: 'pretty' | 'json'
  readonly collectionTimeout?: number
  readonly shutdownGrace?: number
}
