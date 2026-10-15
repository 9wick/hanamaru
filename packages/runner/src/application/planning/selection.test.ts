import { createTestTarget } from '@zeltjs/testing/vitest'
import { expect, test } from 'vite-plus/test'
import { Test, middleware, resource } from '../../../../../src/index.js'
import { completedDefinitions, validatedBlueprints } from '@hanamaru/blueprint/model'
import { ExecutionPlanner } from './planner.js'

function definitions() {
  const db = resource({ name: 'db', scope: 'perRun', setup: async (_, next) => next({ db: 3 }) })
  const child = new Test<{ seed: number }>()
    .require(db)
    .target((value: number) => value)
    .each('same name', [1, 2], (t, row) =>
      t.argsFrom((ctx) => [ctx.seed + row]).expect((e) => [e.result.toBe(e.ctx.seed + row)]),
    )
  const root = new Test().group(
    'parent',
    middleware(async (_, next) => next({ seed: 7 })),
    [child],
  )
  return { blueprints: validatedBlueprints(completedDefinitions(root)), db }
}

const roots = [{ file: '/project/private.ts', index: 0, origin: { file: '/project/private.ts', line: 12, column: 1 } }]

// 契約: 同名でもcase IDは一意。選択で祖先・資源・worker用の元pathを失わない。
test('exact case selection retains its ancestor middleware, resource and original index', async () => {
  const { target: planner } = await createTestTarget(ExecutionPlanner)
  const { blueprints, db } = definitions()
  const catalogue = planner.catalogue(blueprints, roots)
  expect(new Set(catalogue.cases.map((target) => target.id)).size).toBe(2)
  const selected = catalogue.cases[1]
  const plan = planner.create(blueprints, { target: { kind: 'id', id: selected.id } }, roots)
  const parent = plan.nodes[0]
  expect.assert(parent.kind === 'group')
  expect(parent.bp.middleware).not.toBeNull()
  const child = parent.children[0]
  expect.assert(child.kind === 'test')
  expect(child.bp.cases).toHaveLength(1)
  expect(child.bp.cases[0].originalIndex).toBe(1)
  expect(child.originalIndex).toBe(0)
  expect(plan.resources).toEqual([db])
  const filtered = planner.create(blueprints, { target: { kind: 'id', id: selected.id }, filter: 'same name' }, roots)
  const filteredParent = filtered.nodes[0]
  expect.assert(filteredParent.kind === 'group')
  const filteredChild = filteredParent.children[0]
  expect.assert(filteredChild.kind === 'test')
  expect(filteredChild.bp.cases[0].originalIndex).toBe(1)
})

test('definition selection keeps all its cases and unknown IDs fail before execution', async () => {
  const { target: planner } = await createTestTarget(ExecutionPlanner)
  const { blueprints } = definitions()
  const catalogue = planner.catalogue(blueprints, roots)
  const plan = planner.create(blueprints, { target: { kind: 'id', id: catalogue.definitions[0].id } }, roots)
  const parent = plan.nodes[0]
  expect.assert(parent.kind === 'group')
  const child = parent.children[0]
  expect.assert(child.kind === 'test')
  expect(child.bp.cases).toHaveLength(2)
  expect(() => planner.create(blueprints, { target: { kind: 'id', id: 'missing' } }, roots)).toThrow('not found')
})

test('combining ID and name filters preserves the selected outer root index', async () => {
  const { target: planner } = await createTestTarget(ExecutionPlanner)
  const { blueprints } = definitions()
  const inputs = [...blueprints, ...blueprints]
  const references = [...roots, { ...roots[0], index: 1 }]
  const catalogue = planner.catalogue(inputs, references)
  const selected = catalogue.cases[3]
  const plan = planner.create(inputs, { target: { kind: 'id', id: selected.id }, filter: 'same name' }, references)
  expect(plan.nodes[0].originalIndex).toBe(1)
})
