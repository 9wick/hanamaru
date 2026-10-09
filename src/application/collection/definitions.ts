import { Injectable } from '@zeltjs/core'
import type { RuntimeBlueprint, RuntimeDefinitionHandle } from '../../domain/definition/runtime.js'
import { validatedBlueprints } from '../../domain/definition/validation.js'

/** 完成した定義を検証し、登録順を保ったまま計画作成へ渡す。 */
@Injectable()
export class DefinitionCollector {
  collect(definitions: readonly RuntimeDefinitionHandle[]): RuntimeBlueprint[] {
    return validatedBlueprints(definitions)
  }
}
