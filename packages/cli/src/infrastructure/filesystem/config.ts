import { globSync } from 'node:fs'
import { resolve } from 'node:path'
import * as v from 'valibot'
import { configSchema } from '../../application/collection/config-schema.js'
import type { Config } from '../../application/collection/config.js'
import type { CliOptions } from '../../application/collection/options.js'
import { property } from '../../application/collection/javascript.js'
export async function readConfig(options: CliOptions, onLoading: (file: string) => void): Promise<Config> {
  const foundConfigs = [...globSync('hanamaru.config.{ts,js,mts,mjs}', { cwd: process.cwd() })].sort()
  const configPath = resolve(options.config ?? foundConfigs[0] ?? 'hanamaru.config.ts')
  let config: Config = {}
  if (options.config || foundConfigs.length) {
    onLoading(configPath)
    const { loadConfigFromFile } = await import('@hanamaru/vite')
    const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, configPath, process.cwd(), 'silent')
    if (!loaded) throw new Error(`cannot load config: ${configPath}`)
    if (Object.hasOwn(loaded.config, 'include') || Object.hasOwn(loaded.config, 'exclude'))
      throw new TypeError('include and exclude must be configured in projects')
    const viteConfig = property(loaded.config, 'vite')
    if (
      viteConfig !== undefined &&
      (viteConfig === null || typeof viteConfig !== 'object' || Array.isArray(viteConfig))
    )
      throw new TypeError('vite must be a config object')
    config = v.parse(configSchema, loaded.config)
  }

  return config
}
