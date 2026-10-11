import { expect, test } from 'vite-plus/test'
import * as blueprint from './index.js'
import { Test } from '../../../src/index.js'

test('the blueprint entry exposes test authoring and shares its constructor with hanamaru', () => {
  expect(Object.keys(blueprint).sort()).toEqual(['Test', 'middleware', 'registerTest', 'relation', 'resource'])
  expect(blueprint.Test).toBe(Test)
  let calls = 0
  const specification = new blueprint.Test()
    .target(() => ++calls)
    .it('value', (t) => t.args().expect((e) => [e.result.toBe(1)]))
  expect(specification.blueprint().kind).toBe('test')
  expect(calls).toBe(0)
})
