import { definitionTag } from '../../domain/definition/tags.js'
import type { SourceLocation } from '../../domain/definition/types.js'
import { property } from '../../foundation/value.js'
interface TrackedDefinition {
  readonly origin: SourceLocation
  used: boolean
}
let trackedDefinitions: Map<object, TrackedDefinition> | null = null
export function startDefinitionTracking(): void {
  trackedDefinitions = new Map()
}
export function trackDefinition(definition: object, location: () => SourceLocation): void {
  if (trackedDefinitions) trackedDefinitions.set(definition, { origin: location(), used: false })
}
export function markDefinitionUsed(definition: object): void {
  const previous = trackedDefinitions?.get(definition)
  if (previous) previous.used = true
}
export function unregisteredDefinitions(files: ReadonlySet<string>, registered: ReadonlySet<object>): SourceLocation[] {
  return [...(trackedDefinitions ?? [])].flatMap(([definition, record]) =>
    files.has(record.origin.file) &&
    property(definition, definitionTag) === true &&
    !record.used &&
    !registered.has(definition)
      ? [record.origin]
      : [],
  )
}
