import * as v from 'valibot'
import type { RuntimeBlueprint, RuntimeDefinitionHandle } from './runtime.js'
import { definitionTag } from './tags.js'

/**
 * v.instance と isDefinition のためのブランド基底。定義データも宣言位置も持たない。
 * v.instance は抽象クラスを受け取れないので、基底にも blueprint() の実体を置く。
 */
export class DefinitionBuilder {
  /** 完成した定義だけが true を持つ。未完成でも own key は残り、チェーンの公開面を一定に保つ。 */
  readonly [definitionTag]?: true
  constructor(completed: boolean) {
    if (completed) this[definitionTag] = true
  }
  blueprint(): RuntimeBlueprint {
    throw new TypeError('test definition is incomplete')
  }
}

export function isDefinition<T>(value: T): boolean {
  return value instanceof DefinitionBuilder && value[definitionTag] === true
}

export function completedDefinitions(input: unknown): RuntimeDefinitionHandle[] {
  const received = Array.isArray(input) ? input : [input]
  if (!received.length || received.some((definition: unknown) => !isDefinition(definition)))
    throw new TypeError('run requires completed definitions')
  return received.map((definition: unknown) => v.parse(v.instance(DefinitionBuilder), definition))
}
