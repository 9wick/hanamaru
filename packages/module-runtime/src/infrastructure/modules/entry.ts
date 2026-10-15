import { Config } from '@zeltjs/core'

/**
 * test runtimeが `hanamaru` を解決する公開入口のURL。
 * 配布物の階層に実装の置き場所が影響しないよう、起動ファイルだけがこれを決める。
 */
@Config({ abstract: true })
export abstract class ModuleEntry {
  abstract readonly url: URL
}
