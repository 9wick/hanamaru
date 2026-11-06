import { expect, test } from 'vite-plus/test'
import * as api from './index.js'
import { Test } from '@hanamaru/blueprint'

test('the public package exposes authoring and shares its Test identity', () => {
  expect(api.Test).toBe(Test)
  expect(Object.keys(api).sort()).toEqual([
    'Test',
    'arrays',
    'boolean',
    'constant',
    'defineConfig',
    'environment',
    'integers',
    'method',
    'middleware',
    'oneOf',
    'record',
    'registerTest',
    'resource',
    'scenario',
    'strings',
    'tuples',
    'valueAdapter',
  ])
})
