import { expect, test } from 'vite-plus/test'
import { Test, run } from './index.js'

test('run owns the active guard while collecting its blueprint', async () => {
  const suite = new Test().target(() => 1).it('one', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  const blueprint = suite.blueprint.bind(suite)
  let nested: Promise<void> | undefined,
    reads = 0
  suite.blueprint = () => {
    reads++
    nested = expect(run(suite)).rejects.toThrow(/a run is already active/)
    return blueprint()
  }
  const result = await run(suite)
  await nested
  expect(result.status).toBe('passed')
  expect(reads).toBe(1)
})

test('runtime rejects concurrent runs and empty input', async () => {
  const suite = new Test()
    .target(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
      return 1
    })
    .it('slow', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  const ongoing = run(suite)
  await expect(run(suite)).rejects.toThrow(/already active/)
  expect((await ongoing).status).toBe('passed')
  await expect(run([])).rejects.toThrow(/requires completed/)
})
