import type { RuntimeDefinitionHandle } from '../../domain/definition/runtime.js'
import type { SourceLocation } from '../../domain/definition/types.js'

export type CollectionEvent =
  | { kind: 'declared'; definition: object; origin: SourceLocation }
  | { kind: 'consumed'; definition: object }
  | { kind: 'registered'; definition: RuntimeDefinitionHandle; origin: SourceLocation }

export type RegisteredTest = Extract<CollectionEvent, { kind: 'registered' }>

/** events は追記のみで、追記順が登録順。execution workerの整合チェックがこの順序に依存する。 */
export interface CollectionScope {
  readonly events: CollectionEvent[]
}

export function createCollectionScope(): CollectionScope {
  return { events: [] }
}

export function registrationsIn(scope: CollectionScope, file: string): RegisteredTest[] {
  return scope.events.flatMap((event) => (event.kind === 'registered' && event.origin.file === file ? [event] : []))
}

export function unregisteredDefinitions(scope: CollectionScope, files: ReadonlySet<string>): SourceLocation[] {
  const declared = new Map<object, SourceLocation>()
  const used = new Set<object>()
  for (const event of scope.events)
    if (event.kind === 'declared') declared.set(event.definition, event.origin)
    else used.add(event.definition)
  return [...declared].flatMap(([definition, origin]) =>
    files.has(origin.file) && !used.has(definition) ? [origin] : [],
  )
}
