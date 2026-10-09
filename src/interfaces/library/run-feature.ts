import { Feature, type ServiceResolver } from '@zeltjs/core'
import { LibraryRun } from './run.js'

interface LibraryCapabilities {
  readonly run: LibraryRun['run']
}

/** 公開関数の入口をZeltJSのruntimeへ接続する。サービスの解決はFeatureの初期化で行う。 */
export class LibraryFeature extends Feature<'library', LibraryCapabilities> {
  readonly key = 'library' as const

  featureClasses(): readonly [typeof LibraryRun] {
    return [LibraryRun]
  }

  blueprint(): Record<never, never> {
    return {}
  }

  async realize(resolver: ServiceResolver): Promise<LibraryCapabilities> {
    const entry = await resolver.get(LibraryRun)
    return { run: entry.run.bind(entry) }
  }
}
