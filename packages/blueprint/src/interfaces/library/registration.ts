import * as v from 'valibot'
import type { DeclarationEvent } from '../../application/declarations.js'
import type { SourceLocation, TestDefinition } from '../../domain/definition/types.js'
import { DefinitionBuilder, isDefinition } from '../../domain/definition/handle.js'

export function createRegisterTest(location: () => SourceLocation, record: (event: DeclarationEvent) => void) {
  return function registerTest(root: TestDefinition<{}>): void {
    const definition = v.parse(v.instance(DefinitionBuilder), root)
    if (!isDefinition(definition)) throw new TypeError('registerTest requires a completed test definition')
    record({ kind: 'registered', definition, origin: location() })
  }
}
