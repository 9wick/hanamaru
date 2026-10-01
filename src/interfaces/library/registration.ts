import * as v from 'valibot'
import type { CollectionEvent } from '../../application/collection/scope.js'
import type { SourceLocation, TestDefinition } from '../../domain/definition/types.js'
import { DefinitionBuilder, isDefinition } from './definition.js'

export function createRegisterTest(location: () => SourceLocation, record: (event: CollectionEvent) => void) {
  return function registerTest(root: TestDefinition<{}>): void {
    const definition = v.parse(v.instance(DefinitionBuilder), root)
    if (!isDefinition(definition)) throw new TypeError('registerTest requires a completed test definition')
    record({ kind: 'registered', definition, origin: location() })
  }
}
