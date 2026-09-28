import { defineConfig } from 'hanamaru'

export default defineConfig({
  projects: {
    default: {
      include: ['**/*.{test,spec}.ts'],
      exclude: ['**/node_modules/**', '**/dist/**'],
    },
  },
  reporter: 'pretty',
  collectionTimeout: 120_000,
  shutdownGrace: 5_000,
})
