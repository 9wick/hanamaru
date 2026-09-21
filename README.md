# hanamaru

Honoのように、短いチェーンで型を積み上げる、軽量なテストフレームワーク。
対象・モック・引数・期待を書けば、その定義が構造化された実行計画になります。

```ts
import { Test } from 'hanamaru'
import { createUser, userRepository, mailService } from './user.ts'

export const users = new Test()
  .target(createUser)
  // 以降のケースで使う共通設定。対象と振る舞いを一緒に決める。
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .mock(mailService, 'send', m => m.resolves(undefined))
  .it('保存して通知する', t => t
    .args({ name: 'Alice' })
    .expect(e => [
      e.result.toEqual({ id: 'u1' }),
      e.mock(mailService, 'send').calledOnceWith({ id: 'u1' }),
    ])
  )
  .it('保存に失敗したら通知しない', t => t
    // このケースだけ、共通設定を上書きする。
    .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
    .args({ name: 'Alice' })
    .expect(e => [
      e.error.toBeInstanceOf(Error),
      e.mock(mailService, 'send').notCalled(),
    ])
  )
```

`.target()` から引数と戻り値の型が決まり、登録したモックを `.expect()` から参照できます。
共通のモックを変えたいケースでは、同じ `.mock(obj, key, ...)` を書くだけです。
正常終了も例外も、期待する内容を同じ `.expect()` に並べます。

## 小さく始める

純粋関数なら、対象・引数・期待だけで書けます。

```ts
import { Test } from 'hanamaru'
import { add } from './math.ts'

export const addition = new Test()
  .target(add)
  .it('2つの数を足す', t => t.args(1, 2).expect(e => [
    e.result.toBe(3),
  ]))
```

## 定義は実行計画になる

```ts
import { run } from 'hanamaru'
import { users } from './user.test.ts'

const plan = users.plan()
const result = await run(plan)
```

`.plan()` はテストを実行せず、対象、準備、ケースごとのモック、引数、期待の組み立て方を返します。
この実行計画がmetadataです。定義することと、実行することを分離します。
テストを書くために、識別子やソース位置を別途登録する必要はありません。

## ドキュメント

- [はじめる](./docs/getting-started.md)
- [設計思想](./docs/concepts.md)
- [Test ビルダー](./docs/api-test.md) / [it ビルダー](./docs/api-it.md)
- [モック](./docs/api-mock.md) / [マッチャ](./docs/api-expect.md)
- [テストの再利用](./docs/reuse.md)
- [実行計画とmetadata](./docs/metadata.md)
- [実行セマンティクス](./docs/semantics.md) / [CLI](./docs/cli.md)
- [型推論](./docs/type-inference.md) / [制約と実装状況](./docs/limitations.md)

## 現在の状態

公開APIを設計している段階です。ビルダー・ランナー・CLIは未実装です。
このリポジトリでは、[型契約](./docs/spec/hanamaru.d.ts)と[サンプル](./docs/examples/)を次のコマンドで検証できます。

```console
tsc -p docs/spec/tsconfig.json
```

実行時依存0を目標とし、型チェックにはTypeScriptを使います。
