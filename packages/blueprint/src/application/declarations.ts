import type { RuntimeDefinitionHandle } from '../domain/definition/runtime.js'
import type { SourceLocation } from '../domain/definition/types.js'

export type DeclarationEvent =
  | { kind: 'declared'; definition: object; origin: SourceLocation }
  | { kind: 'consumed'; definition: object }
  | { kind: 'registered'; definition: RuntimeDefinitionHandle; origin: SourceLocation }

let sink: ((event: DeclarationEvent) => void) | null = null

/** DSLの宣言通知を読み込みの間だけ接続する。ログの保持・問い合わせは受け取り側の責務。 */
export async function observeDeclarations<T>(
  record: (event: DeclarationEvent) => void,
  load: () => Promise<T>,
): Promise<T> {
  if (sink) throw new TypeError('a collection scope is already open')
  sink = record
  try {
    return await load()
  } finally {
    sink = null
  }
}

export function recordDeclaration(event: DeclarationEvent): void {
  sink?.(event)
}
