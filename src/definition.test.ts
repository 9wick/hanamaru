import { expect, test } from 'vite-plus/test'
import { fileURLToPath } from 'node:url'
import { Test } from './index.js'

const selfFile = fileURLToPath(import.meta.url)
const double = (value: number): number => value * 2

// 宣言行はこのファイル内の行番号なので、下の .it() を動かしたらこの定数も合わせる。
const itLine = 11

const suite = new Test().target(double).it('double', (t) => t.args(2).expect((e) => [e.result.toBe(4)]))

test('case origin points at the declaring test file itself', () => {
  const blueprint = suite.blueprint()
  expect.assert(blueprint.kind === 'test')
  const origin = blueprint.cases[0]?.origin
  expect(origin?.file).toBe(selfFile)
  expect(origin?.line).toBe(itLine)
})
