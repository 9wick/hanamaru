import { observeDeclarations } from '@hanamaru/blueprint/declarations'
import type { CollectionLog } from './scope.js'

export function collectWithin<T>(log: CollectionLog, load: () => Promise<T>): Promise<T> {
  return observeDeclarations((event) => log.append(event), load)
}
