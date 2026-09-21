# テストの再利用

同じ振る舞いを複数の実装に要求したいときは、テストを返す関数に依存を渡します。
ケースを追加済みの定義へ、後からsetupを差し込む必要はありません。

## 共通の振る舞いを2つの実装で確かめる

`store.ts`。Mapを使う実装と、オブジェクトを使う実装です。

```ts
export interface Store {
  put(key: string, value: string): Promise<void>
  get(key: string): Promise<string | undefined>
}

export function memoryStore(): Store {
  const values = new Map<string, string>()
  return {
    async put(key, value) { values.set(key, value) },
    async get(key) { return values.get(key) },
  }
}

export function objectStore(): Store {
  const values: Record<string, string> = Object.create(null)
  return {
    async put(key, value) { values[key] = value },
    async get(key) { return values[key] },
  }
}
```

`store.contract.ts`。Storeに保存して読み出す処理を対象にし、同じ2ケースを定義します。

```ts
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
```

`store.test.ts`。

```ts
import { storeContract } from './store.contract.ts'
import { memoryStore, objectStore } from './store.ts'

export const memory = storeContract(memoryStore)
export const object = storeContract(objectStore)
```

これで「保存した値を読める」「同じキーなら置き換わる」の両方を、2つの実装に対して検証します。
2ケース×2実装で4ケースです。書き換えの検証では、同じケース内で2回保存しています。
例えば一方のputを「既存キーなら何もしない」に変えると、その実装の置き換えケースが失敗する契約です。

setupの戻り値が `argsFrom` を通じてtargetへ渡るため、選んだ実装が実際の検証に使われます。
各ケースでcreateを呼ぶので、この2つのfactoryでは毎回新しいStoreになります。
外部リソースを使う実装では、第2引数のdisposeを渡せます。

ケースを足せば両実装に同じ検証が増え、実装を足すときはfactoryを1つ渡すだけです。

## 共通設定から派生する

ケースを共通化するほどでなければ、設定済みビルダーを値として使えます。

```ts
const base = new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .mock(mailService, 'send', m => m.resolves(undefined))

export const alice = base.it('Aliceを保存する', t => t
  .args({ name: 'Alice' })
  .expectCalls(call => [call(userRepository, 'save').calledOnceWith({ name: 'Alice' })]))

export const bob = base.it('Bobを保存する', t => t
  .args({ name: 'Bob' })
  .expectCalls(call => [call(userRepository, 'save').calledOnceWith({ name: 'Bob' })]))
```

baseは変わらず、aliceとbobはそれぞれ1ケースを持つ定義です。
共通の値を置くだけでは状態の独立性は保証されません。ケースごとに必要な値はsetupで生成します。
CLIによる収集は[CLI](./cli.md)、ビルダーの段階は[Test ビルダー](./api-test.md)を参照してください。
