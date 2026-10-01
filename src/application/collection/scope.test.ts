import { expect, test } from 'vite-plus/test'
import type { RuntimeBlueprint, RuntimeDefinitionHandle } from '../../domain/definition/runtime.js'
import type { SourceLocation } from '../../domain/definition/types.js'
import type { CollectionEvent } from './scope.js'
import { createCollectionScope, registrationsIn, unregisteredDefinitions } from './scope.js'

const empty: RuntimeBlueprint = { version: 1, kind: 'definition', config: {}, steps: [], mocks: [], children: [] }

function handle(): RuntimeDefinitionHandle {
  return { blueprint: () => empty }
}

function at(file: string, line: number, column = 1): SourceLocation {
  return { file, line, column }
}

function scopeOf(events: CollectionEvent[]) {
  const scope = createCollectionScope()
  scope.events.push(...events)
  return scope
}

test('a new scope has no events', () => {
  expect(createCollectionScope().events).toEqual([])
})

test('registrations are selected by file and keep the order they were appended in', () => {
  const [first, second, other] = [handle(), handle(), handle()]
  const scope = scopeOf([
    { kind: 'declared', definition: first, origin: at('a.ts', 1) },
    { kind: 'registered', definition: second, origin: at('a.ts', 20) },
    { kind: 'registered', definition: other, origin: at('b.ts', 30) },
    { kind: 'consumed', definition: second },
    { kind: 'registered', definition: first, origin: at('a.ts', 10) },
  ])
  expect(registrationsIn(scope, 'a.ts').map((entry) => entry.origin.line)).toEqual([20, 10])
  expect(registrationsIn(scope, 'a.ts').map((entry) => entry.definition)).toEqual([second, first])
  expect(registrationsIn(scope, 'b.ts').map((entry) => entry.origin.line)).toEqual([30])
  expect(registrationsIn(scope, 'c.ts')).toEqual([])
})

test('the same definition registered twice is reported twice', () => {
  const shared = handle()
  const scope = scopeOf([
    { kind: 'registered', definition: shared, origin: at('a.ts', 1) },
    { kind: 'registered', definition: shared, origin: at('a.ts', 2) },
  ])
  expect(registrationsIn(scope, 'a.ts').map((entry) => entry.origin.line)).toEqual([1, 2])
})

test('unregistered definitions keep their declaration order and drop consumed, registered and foreign ones', () => {
  const [orphan, later, child, root, foreign] = [handle(), handle(), handle(), handle(), handle()]
  const scope = scopeOf([
    { kind: 'declared', definition: child, origin: at('a.ts', 1) },
    { kind: 'declared', definition: orphan, origin: at('a.ts', 2) },
    { kind: 'declared', definition: foreign, origin: at('b.ts', 3) },
    { kind: 'consumed', definition: child },
    { kind: 'declared', definition: root, origin: at('a.ts', 4) },
    { kind: 'declared', definition: later, origin: at('a.ts', 5) },
    { kind: 'registered', definition: root, origin: at('a.ts', 6) },
  ])
  expect(unregisteredDefinitions(scope, new Set(['a.ts']))).toEqual([at('a.ts', 2), at('a.ts', 5)])
  expect(unregisteredDefinitions(scope, new Set(['a.ts', 'b.ts']))).toEqual([
    at('a.ts', 2),
    at('b.ts', 3),
    at('a.ts', 5),
  ])
  expect(unregisteredDefinitions(scope, new Set<string>())).toEqual([])
})

test('a definition consumed by more than one parent is not reported', () => {
  const reused = handle()
  const scope = scopeOf([
    { kind: 'declared', definition: reused, origin: at('a.ts', 1) },
    { kind: 'consumed', definition: reused },
    { kind: 'consumed', definition: reused },
  ])
  expect(unregisteredDefinitions(scope, new Set(['a.ts']))).toEqual([])
})
