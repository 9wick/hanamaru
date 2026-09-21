# テストを再利用する

再利用するのは、共通の設定またはケースを組み立てる関数である。
完成済みのケースのtarget・setupを後から差し替えるメソッドは提供しない。

## 共通設定から分岐する

```ts
const base = new Test().target(add)

export const positive = base
  .it('正数', t => t.args(1, 2).expect(e => [e.result.toBe(3)]))
export const negative = base
  .it('負数', t => t.args(-1, -2).expect(e => [e.result.toBe(-3)]))
```

`base` は変化しない。ケース追加後の値はケース追加と `.plan()` だけを持つ。
CLIに読ませるファイルでは、設定途中のbaseをexportせず、完成したテストをexportする。

## 同じ仕様を異なる実装へ適用する

Storeに「保存した値を読める」「同じキーへの保存で値を置き換える」という仕様を求める。
実装ごとに新しいStoreを作り、同じケースを適用する。

`src/store.ts`。2つの実装はどちらも完全なコードである。

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

`src/store.contract.ts`。setupの戻り値を `targetFrom` に接続する。
この例のtargetは、Storeへ書いてから読む、一連の操作を表す関数である。

```ts
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
```

2つ目のケースは、同じケース内で `first` と `second` を順に保存してから読む。
別ケースに残った値には依存しない。各ケースが別のStoreを作る。

`src/store.test.ts`。

```ts
import { storeContract } from './store.contract.ts'
import { memoryStore, objectStore } from './store.ts'

export const memory = storeContract(memoryStore, {
  file: 'src/store.ts', exportName: 'memoryStore',
})
export const object = storeContract(objectStore, {
  file: 'src/store.ts', exportName: 'objectStore',
})
```

同じ2ケースが2実装に適用され、合計4ケースになる。
`source` はこの例では対象実装を作るexport宣言を指す、利用者による任意の注釈である。
実行器はそのファイルをimportして対象を作り直さず、渡された関数を使う。

DB等の資源を使う実装では、第3引数に後始末を渡せる。
`create` の戻り値は同期・非同期の両方に対応し、`dispose` は解決後のStoreを受け取る。
実装を作る側は、生成途中で失敗した場合の後始末も担当する。

## 文脈からモック対象を取得する

```ts
new Test()
  .setup(() => makeFixture())
  .targetFrom(ctx => ctx.service.create.bind(ctx.service), { name: 'UserService.create' })
  .mockFrom('save', ctx => ctx.repository, 'save', m => m.resolves({ id: 'u1', name: 'Alice' }))
  .it('保存する', t => t.args({ name: 'Alice' }).expect(e => [
    e.mock('save').calledOnceWith({ name: 'Alice' }),
  ]))
```

この断片の `makeFixture` は、serviceとrepositoryを接続したfixtureを返す関数を想定する。
`targetFrom` と `mockFrom` が受け取るのは同じケースのコンテキストである。
対象を生成する処理は `.plan()` では動かず、実行時のsetup後に評価される。
