import type { RuntimeBlueprint } from '../../domain/definition/runtime.js'
import type { SourceLocation } from '../../domain/definition/types.js'
import { validateBlueprint } from '../../domain/definition/validation.js'
export interface CollectedDefinition {
  blueprint(): RuntimeBlueprint
}
export interface RegisteredTest {
  readonly definition: CollectedDefinition
  readonly origin: SourceLocation
}
const registrations: RegisteredTest[] = []
export function addRegistration(entry: RegisteredTest): void {
  registrations.push(entry)
}
export function resetRegistrations(): void {
  registrations.length = 0
}
export function registrationsIn(file: string): RegisteredTest[] {
  return registrations.filter((item) => item.origin.file === file)
}
export function collectBlueprints(definitions: readonly CollectedDefinition[]): RuntimeBlueprint[] {
  if (!definitions.length) throw new TypeError('run requires completed definitions')
  const blueprints = definitions.map((definition) => definition.blueprint())
  blueprints.forEach((blueprint) => validateBlueprint(blueprint))
  return blueprints
}
