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
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'eslint.config.test.ts'],
        },
      },
      {
        test: {
          name: 'e2e-workspace',
          include: ['e2e/workspace-cli.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
      {
        test: {
          name: 'e2e-package',
          include: ['e2e/installed-package.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
    ],
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
