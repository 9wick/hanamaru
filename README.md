# hanamaru

Honoのように、短いチェーンで型を積み上げる、軽量なテストフレームワーク。
対象・モック・引数・期待を書けば、その定義が構造化された実行計画になります。

```ts
import { Test } from 'hanamaru'
import { createUser, userRepository, mailService } from './user.ts'

export const users = new Test()
  .target(createUser)
  // 振る舞いを変えたい依存だけ、共通のモックを設定する。
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .it('保存して通知する', t => t
    .args({ name: 'Alice' })
    .expect(e => [
      e.result.toEqual({ id: 'u1' }),
    ])
    .expectCalls(call => [
      call(mailService, 'send').calledOnceWith({ id: 'u1' }),
    ])
  )
  .it('保存に失敗したら通知しない', t => t
    // このケースだけ、共通設定を上書きする。
    .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
    .args({ name: 'Alice' })
    .expect(e => [
      e.error.toBeInstanceOf(Error),
    ])
    .expectCalls(call => [
      call(mailService, 'send').notCalled(),
    ])
  )
```

`.target()` から引数と戻り値の型が決まります。
戻り値・例外は `.expect()`、呼ばれ方は `.expectCalls()` に条件を並べます。
呼び出しの記録は自動で設定するので、検証のためにmockやspyを登録する必要はありません。
振る舞いを変えたい依存だけ `.mock(obj, key, ...)` で設定し、ケース内の同じmockで上書きできます。

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

## モックなしでも呼び出しを検証する

```ts
import { Test } from 'hanamaru'
import { createUser, userRepository, mailService } from './user.ts'

// モックを設定せず、本物の処理がどう呼ばれるかを検証する。
export const calls = new Test()
  .target(createUser)
  .it('保存して通知する', t => t
    .args({ name: 'Alice' })
    .expectCalls(call => [
      call(userRepository, 'save').calledOnceWith({ name: 'Alice' }),
      call(mailService, 'send').calledOnceWith({ id: 'u1' }),
    ]))
```

この例ではsaveとsendの本物の処理を呼び、その呼ばれ方を検証します。

## テストを合成する

```ts
const tests = new Test()
  .mock(mailService, 'send', m => m.resolves(undefined))
  .group(userTests)
  .group('退会', deletionTests)
```

別々に定義したテストをgroupでまとめ、配下へ共通のmockやsetupを適用できます。
名前は任意です。子の設定はその子の配下だけに適用し、元の定義や兄弟へ影響しません。
親のctxを使う子の書き方は[テストの合成とスコープ](./docs/composition.md)を参照してください。

## 定義は実行計画になる

```ts
import { run } from 'hanamaru'
import { users } from './user.test.ts'

const plan = users.plan()
const result = await run(plan)
```

`.plan()` はテストを実行せず、合成の階層、対象、準備、各スコープのモック、引数、呼び出し条件、結果の期待の組み立て方を返します。
この実行計画がmetadataです。定義することと、実行することを分離します。
テストを書くために、識別子やソース位置を別途登録する必要はありません。

## ドキュメント

- [はじめる](./docs/getting-started.md)
- [設計思想](./docs/concepts.md)
- [Test ビルダー](./docs/api-test.md) / [it ビルダー](./docs/api-it.md)
- [モック](./docs/api-mock.md) / [マッチャ](./docs/api-expect.md)
- [テストの合成とスコープ](./docs/composition.md)
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
