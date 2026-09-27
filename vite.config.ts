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
    deps: { neverBundle: ['@hanamaru/vite', '@hanamaru/vite/module-runner', 'acorn'] },
    entry: ['src/index.js', 'src/cli.js', 'src/cli-worker.js', 'src/execution-worker.js'],
    dts: false,
    fixedExtension: false,
    format: 'esm',
    platform: 'node',
    outDir: 'dist',
  },
})
