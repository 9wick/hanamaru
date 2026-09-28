import type { Config } from './api.js'
export type * from './api.js'
export { Test, middleware } from './definition.js'
export { registerTest } from './registration.js'
export { run } from './runner.js'
export function defineConfig(config: Config): Config {
  return config
}
