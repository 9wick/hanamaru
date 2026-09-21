import { Test } from 'hanamaru'
import type { Store } from './store.ts'

export async function writeAndRead(
  store: Store,
  writes: readonly (readonly [string, string])[],
  key: string,
): Promise<string | undefined> {
  for (const [name, value] of writes) await store.put(name, value)
  return store.get(key)
}

export function storeContract(
  create: () => Store | Promise<Store>,
  dispose?: (store: Store) => void | Promise<void>,
) {
  return new Test()
    .target(writeAndRead)
    .setup(create, dispose)
    .it('保存した値を読める', t => t
      .argsFrom(store => [store, [['a', 'first']], 'a'])
      .expect(e => [e.result.toBe('first')]))
    .it('同じキーへの保存で値を置き換える', t => t
      .argsFrom(store => [store, [['a', 'first'], ['a', 'second']], 'a'])
      .expect(e => [e.result.toBe('second')]))
}
