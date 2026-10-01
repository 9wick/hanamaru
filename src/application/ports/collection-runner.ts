import { Config } from '@zeltjs/core'
import type { MutableRunResult } from '../../domain/result/mutable.js'
import type { CliOptions } from '../collection/options.js'
export interface CollectionRequest {
  files: string[]
  options: CliOptions
}

/**
 * 1回ぶんの結果を人へ見せる手。表示の形は利用者向けの入口が決めるため、宛名だけを置く。
 * 打ち切り時の部分結果も同じ手に渡すため、進行中でも呼ばれる。
 */
@Config({ abstract: true })
export abstract class ResultPresenter {
  abstract present(result: MutableRunResult, reporter: string | undefined): void
}

/** 引数で決まった要求を収集から実行まで進めて、終了コードを決める手。 */
@Config({ abstract: true })
export abstract class CollectionRunner {
  abstract run(request: CollectionRequest): Promise<number>
}
