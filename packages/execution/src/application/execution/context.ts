import { createContextStorage, Injectable } from '@zeltjs/core'
import { createRunData, type RunData } from './run-data.js'

/** サービスを共有したまま、非同期の仕事が参照するrunのデータを決める。 */
@Injectable()
export class RunContext {
  readonly #storage = createContextStorage<RunData>('hanamaru.run')
  #latest = createRunData()

  get scoped(): boolean {
    return this.#storage.get() !== undefined
  }

  /** run内はそのrunの値、通信側などrun外からの観測は直近の値を読む。 */
  get data(): RunData {
    return this.#storage.get() ?? this.#latest
  }

  run<T>(body: () => T): T {
    const data = createRunData()
    this.#latest = data
    return this.#storage.run(data, body)
  }
}
