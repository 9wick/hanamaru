import { resolve } from 'node:path'
import { defineConfig } from 'hanamaru'

export default defineConfig({
  vite: {
    resolve: {
      alias: { '@app': resolve('src') },
    },
    plugins: [],
  },
})
