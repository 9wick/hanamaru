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
    entry: ['src/index.ts', 'src/cli.ts', 'src/cli-worker.ts', 'src/execution-worker.ts'],
    dts: false,
    fixedExtension: false,
    format: 'esm',
    platform: 'node',
    outDir: 'dist',
  },
})
