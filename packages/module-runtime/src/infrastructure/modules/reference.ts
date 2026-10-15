import { Injectable } from '@zeltjs/core'

/** 評価したmodule namespaceの出自。同じruntimeを使う範囲だけで共有する。 */
@Injectable()
export class ModuleRegistry {
  readonly #identities = new WeakMap<object, string>()

  register(namespace: object, id: string): void {
    this.#identities.set(namespace, id)
  }

  identify(namespace: object): string | undefined {
    return this.#identities.get(namespace)
  }
}
