import { Injectable } from '@zeltjs/core'
import type { RuntimeBlueprint, RuntimeDefinitionHandle } from '@hanamaru/blueprint/model'
import { validatedBlueprints } from '@hanamaru/blueprint/model'

/** 完成した定義を検証し、登録順を保ったまま計画作成へ渡す。 */
@Injectable()
export class DefinitionCollector {
  collect(definitions: readonly RuntimeDefinitionHandle[]): RuntimeBlueprint[] {
    return validatedBlueprints(definitions)
  }
}
