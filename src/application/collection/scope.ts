import type { RuntimeDefinitionHandle } from '../../domain/definition/runtime.js'
import type { SourceLocation } from '../../domain/definition/types.js'

export type CollectionEvent =
  | { kind: 'declared'; definition: object; origin: SourceLocation }
  | { kind: 'consumed'; definition: object }
  | { kind: 'registered'; definition: RuntimeDefinitionHandle; origin: SourceLocation }

export type RegisteredTest = Extract<CollectionEvent, { kind: 'registered' }>

function registrationsOf(events: readonly CollectionEvent[], file: string): RegisteredTest[] {
  return events.flatMap((event) => (event.kind === 'registered' && event.origin.file === file ? [event] : []))
}

function unregisteredOf(events: readonly CollectionEvent[], files: ReadonlySet<string>): SourceLocation[] {
  const declared = new Map<object, SourceLocation>()
  const used = new Set<object>()
  for (const event of events)
    if (event.kind === 'declared') declared.set(event.definition, event.origin)
    else used.add(event.definition)
  return [...declared].flatMap(([definition, origin]) =>
    files.has(origin.file) && !used.has(definition) ? [origin] : [],
  )
}

/** 追記のみで、追記順が登録順。execution workerの整合チェックがこの順序に依存する。 */
export class CollectionLog {
  readonly #events: CollectionEvent[] = []
  append(event: CollectionEvent): void {
    this.#events.push(event)
  }
  registrationsIn(file: string): RegisteredTest[] {
    return registrationsOf(this.#events, file)
  }
  unregisteredDefinitions(files: ReadonlySet<string>): SourceLocation[] {
    return unregisteredOf(this.#events, files)
  }
}
