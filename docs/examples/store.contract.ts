import { Test } from 'hanamaru'
import type { SourceRef } from 'hanamaru'
import type { Store } from './store.ts'

export function storeContract(
  create: () => Store | Promise<Store>,
  source: SourceRef,
  dispose?: (store: Store) => void | Promise<void>,
) {
  return new Test()
    .setup(create, dispose)
    .targetFrom(store => async (writes: readonly (readonly [string, string])[], key: string) => {
      for (const [name, value] of writes) await store.put(name, value)
      return store.get(key)
    }, { name: 'Store.put → get', source })
    .it('保存した値を読める', t => t
      .args([['a', 'first']], 'a')
      .expect(e => [e.result.toBe('first')]), { id: 'round-trip' })
    .it('同じキーへの保存で値を置き換える', t => t
      .args([['a', 'first'], ['a', 'second']], 'a')
      .expect(e => [e.result.toBe('second')]), { id: 'replacement' })
}
