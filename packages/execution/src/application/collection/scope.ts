import type { SourceLocation } from '@hanamaru/blueprint/model'
import type { DeclarationEvent } from '@hanamaru/blueprint/declarations'
export type RegisteredTest = Extract<DeclarationEvent, { kind: 'registered' }>

function registrationsOf(events: readonly DeclarationEvent[], file: string): RegisteredTest[] {
  return events.flatMap((event) => (event.kind === 'registered' && event.origin.file === file ? [event] : []))
}

function unregisteredOf(events: readonly DeclarationEvent[], files: ReadonlySet<string>): SourceLocation[] {
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
  readonly #events: DeclarationEvent[] = []
  append(event: DeclarationEvent): void {
    this.#events.push(event)
  }
  registrationsIn(file: string): RegisteredTest[] {
    return registrationsOf(this.#events, file)
  }
  unregisteredDefinitions(files: ReadonlySet<string>): SourceLocation[] {
    return unregisteredOf(this.#events, files)
  }
}

export type { DeclarationEvent as CollectionEvent } from '@hanamaru/blueprint/declarations'
