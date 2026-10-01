import swc from 'unplugin-swc'
import { defineConfig } from 'vite-plus'

// 標準デコレータはOxcの変換を素通りして配布JSに残るため、DIのdecoratorを使うsrcだけSWCに通す。
const decoratorTransform = {
  include: /\/src\/.*\.ts$/,
  jsc: {
    target: 'es2022',
    parser: { syntax: 'typescript', decorators: true },
    transform: { decoratorVersion: '2022-03' },
  },
} as const

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
        plugins: [swc.vite({ ...decoratorTransform, include: /\.ts$/ })],
        oxc: false,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'eslint.config.test.ts'],
        },
      },
      {
        test: {
          name: 'e2e-workspace',
          include: ['e2e/workspace-cli.test.ts', 'e2e/project-registration.test.ts'],
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
    plugins: [swc.rolldown(decoratorTransform)],
    deps: { neverBundle: ['@zeltjs/core', '@hanamaru/vite', '@hanamaru/vite/module-runner', 'acorn'] },
    entry: ['src/index.ts', 'src/cli.ts', 'src/cli-worker.ts', 'src/execution-worker.ts'],
    dts: false,
    fixedExtension: false,
    format: 'esm',
    platform: 'node',
    outDir: 'dist',
  },
})
