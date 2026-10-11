import { createTestTarget } from '@zeltjs/testing/vitest'
import { expect, test } from 'vite-plus/test'
import { Test, resource } from '../../../../../src/index.js'
import { collectBlueprints } from '../../interfaces/library/run.js'
import { ExecutionPlanner } from './planner.js'

// 契約: 実物の構造組立・対象選択・資源計画を通して、元の定義を変えずに今回の計画を作る。
test('planning retains inherited conditions and original paths without rewriting definitions', async () => {
  const { target: planner } = await createTestTarget(ExecutionPlanner)
  const suite = new Test()
    .target((n: number) => n)
    .it('excluded', (t) => t.args(1).expect((e) => [e.result.toBe(1)]))
    .it('selected', (t) => t.args(2).expect((e) => [e.result.toBe(2)]))
  const definitions = collectBlueprints(new Test().timeout(400).retry(2).group('root', [suite]))
  const plan = planner.create(definitions, { filter: 'selected' })
  const group = plan.nodes[0]
  expect.assert(group.kind === 'group')
  const node = group.children[0]
  expect.assert(node.kind === 'test')
  expect(node.config).toEqual({ timeout: 400, retry: 2 })
  expect(node.bp.cases.map((item) => [item.name, item.originalIndex])).toEqual([['selected', 1]])
  const all = plan.allNodes[0]
  expect.assert(all.kind === 'group')
  const original = all.children[0]
  expect.assert(original.kind === 'test')
  expect(original.bp.cases.map((item) => item.name)).toEqual(['excluded', 'selected'])
  expect(original.bp.cases.every((item) => !Object.hasOwn(item, 'originalIndex'))).toBe(true)
  const unfiltered = planner.create(definitions)
  expect(unfiltered.nodes).toEqual(plan.allNodes)
})

test('forbidden focused cases are rejected before filtering can hide them', async () => {
  const { target: planner } = await createTestTarget(ExecutionPlanner)
  const definitions = collectBlueprints(
    new Test()
      .target((n: number) => n)
      .only('focused', (t) => t.args(1).expect((e) => [e.result.toBe(1)]))
      .it('selected', (t) => t.args(2).expect((e) => [e.result.toBe(2)])),
  )
  expect(() => planner.create(definitions, { forbidOnly: true, filter: 'selected' })).toThrow('only is forbidden')
  expect(() => planner.create(definitions, { filter: 'missing' })).toThrow('filter matched no cases')
})

test('planning includes dependencies of runnable selected cases without preparing any resources', async () => {
  const { target: planner } = await createTestTarget(ExecutionPlanner)
  const opened: string[] = []
  const base = resource({
    name: 'base',
    scope: 'perRun',
    setup: (_, next) => {
      opened.push('base')
      return next({ base: 1 })
    },
  })
  const dependent = resource({
    name: 'dependent',
    scope: 'perRun',
    require: [base],
    setup: (_, next) => {
      opened.push('dependent')
      return next({ dependent: 2 })
    },
  })
  const exclusive = resource({
    name: 'exclusive',
    scope: 'perWorker',
    setup: (_, next) => {
      opened.push('exclusive')
      return next()
    },
  })
  const definitions = collectBlueprints(
    new Test()
      .target((n: number) => n)
      .only('focused', (t) =>
        t
          .require(exclusive)
          .args(1)
          .expect((e) => [e.result.toBe(1)]),
      )
      .it('selected', (t) =>
        t
          .require(dependent)
          .args(2)
          .expect((e) => [e.result.toBe(2)]),
      )
      .skip('selected skipped', (t) =>
        t
          .require(exclusive)
          .args(3)
          .expect((e) => [e.result.toBe(3)]),
      ),
  )
  const focused = planner.create(definitions)
  expect(focused.only).toBe(true)
  expect(focused.resources).toEqual([exclusive])
  const selected = planner.create(definitions, { filter: 'selected' })
  expect(selected.only).toBe(false)
  expect(selected.resources).toEqual([base, dependent])
  expect(opened).toEqual([])
})
