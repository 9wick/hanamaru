import { expect, test } from 'vite-plus/test'
import {
  addCase,
  addGroup,
  completedCase,
  emptyCase,
  emptyDefinition,
  groupArguments,
  selectTarget,
  todoCase,
  toBlueprint,
  withArgs,
  withExpectation,
  withRetry,
  withStep,
  withTimeout,
} from './construction.js'
import { doneTag, middlewareTag } from './tags.js'
import type { SourceLocation } from './types.js'

const origin: SourceLocation = { file: '/declaring.test.ts', line: 7, column: 3 }
const host = {
  first(): number {
    return 1
  },
  second(): number {
    return 2
  },
}
const step = { [middlewareTag]: true, kind: 'middleware', run: () => undefined, timeout: undefined } as const
const double = (value: number): number => value * 2

test('settings produce a new object and leave the source data untouched', () => {
  const base = emptyDefinition()
  const configured = withRetry(withTimeout(base, 50), 2)
  expect(configured.config).toEqual({ timeout: 50, retry: 2 })
  expect(base.config).toEqual({})
  expect(withStep(base, step).steps).toEqual([step])
  expect(base.steps).toEqual([])
})

test('input selection is immutable and cannot be replaced after selection', () => {
  const empty = emptyCase()
  const selected = withArgs(empty, { kind: 'value', value: [1] })
  expect(empty.args).toBeNull()
  expect(selected.args).toEqual({ kind: 'value', value: [1] })
  expect(() => withArgs(selected, { kind: 'value', value: [2] })).toThrow('only be selected once')
})

test('selecting a target derives the display name from the input shape', () => {
  expect(selectTarget(emptyDefinition(), [double]).name).toBe('double')
  expect(selectTarget(emptyDefinition(), [() => 1]).name).toBe('<anonymous>')
  expect(selectTarget(emptyDefinition(), ['named', double]).name).toBe('named')
  expect(selectTarget(emptyDefinition(), [host, 'first']).name).toBe('first')
  expect(selectTarget(emptyDefinition(), ['renamed', host, 'first']).name).toBe('renamed')
})

test('selecting a method target keeps the object and the resolved function', () => {
  const target = selectTarget(emptyDefinition(), [host, 'first']).target
  expect(target).toEqual({ kind: 'method', object: host, key: 'first', fn: host.first })
  expect(selectTarget(emptyDefinition(), [double]).stage).toBe('target')
})

test('a case moves the definition to the suite stage and keeps the earlier cases', () => {
  const targeted = selectTarget(emptyDefinition(), [double])
  const first = addCase(targeted, todoCase('first', origin))
  const second = addCase(first, todoCase('second', origin))
  expect(first.stage).toBe('suite')
  expect(second.cases.map((item) => item.name)).toEqual(['first', 'second'])
  expect(first.cases.map((item) => item.name)).toEqual(['first'])
  expect(targeted.cases).toEqual([])
})

test('a case requires arguments and a contract expectation', () => {
  const withArguments = withArgs(emptyCase(), { kind: 'value', value: [2] })
  const build = () => []
  const expected = withExpectation(withArguments, build)
  const base = { name: 'double', mode: 'run', origin, row: null } as const
  expect(expected[doneTag]).toBe(true)
  expect(completedCase(expected, base)).toEqual({
    ...base,
    caseKind: 'example',
    config: {},
    args: { kind: 'value', value: [2] },
    expect: { kind: 'contract', build },
  })
  expect(() => completedCase(withArguments, base)).toThrow('case must return args and an expectation')
})

test('group arguments accept the name and the middleware in any allowed combination', () => {
  const children = [{}]
  expect(groupArguments([children])).toEqual({ name: null, middleware: null, children })
  expect(groupArguments(['named', children])).toEqual({ name: 'named', middleware: null, children })
  expect(groupArguments([step, children]).middleware).toEqual(step)
  const named = groupArguments(['named', step, children])
  expect([named.name, named.children]).toEqual(['named', children])
})

test('a group becomes a child of the definition with the common settings left empty', () => {
  const child = { origin, blueprint: toBlueprint(suiteData()) }
  const grouped = addGroup(emptyDefinition(), { name: 'outer', origin, middleware: null, children: [child] })
  expect(grouped.stage).toBe('group')
  expect(grouped.groups).toEqual([
    {
      version: 1,
      kind: 'group',
      name: 'outer',
      origin,
      middleware: null,
      config: {},
      steps: [],
      children: [child],
    },
  ])
})

function suiteData() {
  return addCase(selectTarget(emptyDefinition(), [double]), todoCase('todo', origin))
}

test('a blueprint copies the collections so later chaining cannot reach it', () => {
  const data = suiteData()
  const blueprint = toBlueprint(data)
  expect.assert(blueprint.kind === 'test')
  expect(blueprint.name).toBe('double')
  expect(blueprint.cases).toEqual(data.cases)
  expect(blueprint.cases).not.toBe(data.cases)
  addCase(data, todoCase('later', origin))
  expect(blueprint.cases).toHaveLength(1)
})

test('a definition of groups keeps every group as a child in declaration order', () => {
  const child = { origin, blueprint: toBlueprint(suiteData()) }
  const one = addGroup(emptyDefinition(), { name: 'one', origin, middleware: null, children: [child] })
  const blueprint = toBlueprint(addGroup(one, { name: 'two', origin, middleware: null, children: [child] }))
  expect.assert(blueprint.kind === 'definition')
  expect(blueprint.children.map((group) => group.name)).toEqual(['one', 'two'])
})
