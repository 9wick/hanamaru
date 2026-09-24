import { defineConfig } from 'vite-plus'

export default defineConfig({
  lint: {
    ignorePatterns: ['docs/spec/**', 'dist/**'],
  },
  fmt: {
    singleQuote: true,
    semi: false,
    printWidth: 120,
    ignorePatterns: ['docs/**', 'dist/**'],
  },
  pack: {
    entry: ['src/index.js', 'src/cli.js', 'src/cli-worker.js', 'src/resolver.js'],
    dts: false,
    fixedExtension: false,
    format: 'esm',
    platform: 'node',
    outDir: 'dist',
  },
})
