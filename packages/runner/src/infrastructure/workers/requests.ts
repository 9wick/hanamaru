import type { Value } from '../../domain/execution/javascript.js'

/**
 * 発番して送った問い合わせと、その返信の突き合わせ。親子のどちら側でも同じ形で使う。
 * 覚えのない返信はprotocolの破れで、どう畳むかは持ち主が決めるため、ここでは見分けた結果だけを返す。
 */
export class PendingReplies<T> {
  readonly #waiting = new Map<number, { resolve: (value: T) => void; reject: (error: Value) => void }>()
  #nextId = 0

  /** 発番は送る前に済ませる。返信が送信と同じtickで届いても、待ち行列には既に載っている。 */
  open(post: (id: number) => void): Promise<T> {
    const id = this.#nextId++
    return new Promise<T>((resolve, reject) => {
      this.#waiting.set(id, { resolve, reject })
      post(id)
    })
  }

  has(id: number): boolean {
    return this.#waiting.has(id)
  }

  settle(id: number, value: T): boolean {
    const entry = this.#take(id)
    entry?.resolve(value)
    return entry !== undefined
  }

  fail(id: number, error: Value): boolean {
    const entry = this.#take(id)
    entry?.reject(error)
    return entry !== undefined
  }

  /** 致命的な失敗では、待っている全部を一度に諦めさせる。 */
  abandon(error: Value): void {
    for (const entry of this.#waiting.values()) entry.reject(error)
    this.#waiting.clear()
  }

  #take(id: number) {
    const entry = this.#waiting.get(id)
    this.#waiting.delete(id)
    return entry
  }
}
