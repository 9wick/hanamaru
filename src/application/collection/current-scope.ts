import type { CollectionEvent, CollectionLog } from './scope.js'

/**
 * DSLは利用者のテストファイルから呼ばれるため、収集側からログを引数で渡せない。
 * 1プロセスで同時に走る収集は1つという前提のもと、記録先をこのポインタ1つに集約する。
 * 前提が破れた場合は二重オープンのthrowで表面化させる。
 */
let openLog: CollectionLog | null = null

export async function collectWithin<T>(log: CollectionLog, load: () => Promise<T>): Promise<T> {
  if (openLog) throw new TypeError('a collection scope is already open')
  openLog = log
  try {
    return await load()
  } finally {
    openLog = null
  }
}

/** スコープの外ではrun()やunit testがDSLを使う。記録先がなければ何もしない。 */
export function recordCollectionEvent(event: CollectionEvent): void {
  openLog?.append(event)
}
