import type { SourceLocation, TestDefinition } from './api.js'
import * as v from 'valibot'
import { DefinitionBuilder, isDefinition } from './definition.js'
import { location } from './shared.js'
import { resolve } from 'node:path'

export interface RegisteredTest {
  readonly definition: DefinitionBuilder
  readonly origin: SourceLocation
}

const registrations: RegisteredTest[] = []

export function registerTest(root: TestDefinition<{}>): void {
  const definition = v.parse(v.instance(DefinitionBuilder), root)
  if (!isDefinition(definition)) throw new TypeError('registerTest requires a completed test definition')
  const origin = location()
  registrations.push({ definition, origin: { ...origin, file: resolve(origin.file) } })
}

export function resetRegistrations(): void {
  registrations.length = 0
}

export function registrationsIn(file: string): RegisteredTest[] {
  return registrations.filter((item) => item.origin.file === file)
}
