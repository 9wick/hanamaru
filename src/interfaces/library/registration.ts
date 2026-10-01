import * as v from 'valibot'
import { recordCollectionEvent } from '../../application/collection/current-scope.js'
import type { SourceLocation, TestDefinition } from '../../domain/definition/types.js'
import { DefinitionBuilder, isDefinition } from './definition.js'

export function createRegisterTest(location: () => SourceLocation) {
  return function registerTest(root: TestDefinition<{}>): void {
    const definition = v.parse(v.instance(DefinitionBuilder), root)
    if (!isDefinition(definition)) throw new TypeError('registerTest requires a completed test definition')
    recordCollectionEvent({ kind: 'registered', definition, origin: location() })
  }
}
