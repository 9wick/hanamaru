import { expect, test } from 'vite-plus/test'
import { parseArgs } from './args.js'

test('CLI treats prototype property names as files, not options', () => {
  for (const word of ['constructor', 'toString'])
    expect(parseArgs([word, 'sample.test.mjs']), word).toStrictEqual({
      options: {},
      files: [word, 'sample.test.mjs'],
    })
})

test('argv parses value options under both short and long names', () => {
  expect(parseArgs(['-t', 'two', '-r', 'json', '-c', 'hanamaru.config.ts', 'sample.test.ts'])).toStrictEqual({
    options: { filter: 'two', reporter: 'json', config: 'hanamaru.config.ts' },
    files: ['sample.test.ts'],
  })
  expect(parseArgs(['--filter', 'two', '--reporter', 'json', '--config', 'hanamaru.config.ts'])).toStrictEqual({
    options: { filter: 'two', reporter: 'json', config: 'hanamaru.config.ts' },
    files: [],
  })
})

test('argv converts timeout options to numbers', () => {
  expect(parseArgs(['--collection-timeout', '250', '--shutdown-grace', '1000'])).toStrictEqual({
    options: { collectionTimeout: 250, shutdownGrace: 1000 },
    files: [],
  })
})

test('argv parses boolean flags', () => {
  expect(parseArgs(['--ci', '--fail-on-flaky', '--no-color', '--help', '--version'])).toStrictEqual({
    options: { ci: true, failOnFlaky: true, noColor: true, help: true, version: true },
    files: [],
  })
  expect(parseArgs(['-h', '-v'])).toStrictEqual({ options: { help: true, version: true }, files: [] })
})

test('argv rejects unknown options and options without a value', () => {
  expect(() => parseArgs(['--unknown'])).toThrow(TypeError)
  expect(() => parseArgs(['--unknown'])).toThrow(/unknown option: --unknown/)
  for (const argv of [['-t'], ['--filter', '--ci'], ['--collection-timeout']])
    expect(() => parseArgs(argv), argv.join(' ')).toThrow(/requires a value/)
})
