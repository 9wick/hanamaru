# hanamaru

Honoのように、短いチェーンで型を積み上げる、軽量なテストフレームワーク。
対象・モック・引数・期待を書き、完成したテストを `run(test)` で実行します。

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

## 行データからケースを書く

```ts
import { Test } from 'hanamaru'
import { add } from './math.ts'

export const addition = new Test()
  .target(add)
  .each('2つの数を足す', [
    { a: 1, b: 2, expected: 3 },
    { a: 2, b: 3, expected: 5 },
  ], (t, row) => t
    .args(row.a, row.b)
    .expect(e => [e.result.toBe(row.expected)]))
```

eachはitと並ぶ入口です。行ごとに名前やIDを追加せず、引数・期待の型を保ってケースを並べます。
[eachの表示と実行](./docs/each.md)を参照してください。

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

## 関連するテストをまとめる

```ts
const tests = new Test()
  .mock(mailService, 'send', m => m.resolves(undefined))
  .group('ユーザー', [userTests, deletionTests])
```

groupで関連するテストを一つのまとまりにし、配下へ共通のmock・use・timeout・retryを適用できます。
名前は任意です。子が一つでも配列で渡します。子の設定はその子の配下だけに適用し、元の定義や兄弟へ影響しません。
グループ化と共通設定の範囲は[テストをグループにまとめる](./docs/grouping.md)を参照してください。

## group全体で資源を共有する

通常の `.use()` は各caseの各attemptを囲みます。
高価な資源を一つのgroup全体で共有したい場合は、そのgroupの子全体をmiddlewareで囲めます。

```ts
const tests = new Test()
  .group(middleware(async (_, next) => {
    const server = await startServer()
    try {
      return await next({ server })
    } finally {
      await server.stop()
    }
  }), [userTests, deletionTests])
```

middlewareは一度だけserverを用意し、`next({ server })` の値を両方の子の各attemptへ渡します。
共有資源のlifetimeを表すだけで、case間の順序依存は許しません。

## 実行設定を下流へ渡す

`.timeout(1_000)` と `.retry(2)` はgroup、`.target()` の前後、ケースで設定できます。
内側で指定した項目だけを上書きし、未指定の項目は親から引き継ぎます。
retryは失敗したケースだけを再試行し、各試行を結果に残します。
[timeoutとretry](./docs/execution-options.md)に設定例と停止の保証を記載しています。

## ケースは独立して実行できる

各caseは、他のcaseが実行されたか、どの順序で実行されたかに依存しないものとして扱います。
宣言順は表示上の順序であり、case間の依存を表しません。middleware・mock・コンテキスト・呼び出し記録は各attemptで作り直します。
将来のshuffle・並列実行・複数processへの配置でも意味が変わらないtestを基本にし、順序を持つ一連の操作は通常のcaseとは分けてflowとして扱う方針です。

## 資源の取得と解放を同じ場所に書く

```ts
.use(middleware(async (_, next) => {
  const db = await createDatabase()
  try {
    return await next({ db })
  } finally {
    await db.close()
  }
}))
```

middlewareは `middleware(fn, options?)` で作り、nextへ渡した値の型は後続のargsFromや`e.ctx`へ伝わります。
値を渡すだけなら `.use(middleware(async (_, next) => next({ expected: 3 })))` と書けます。
詳しくは[middleware](./docs/middleware.md)を参照してください。

## 定義したテストを実行する

```ts
import { run } from 'hanamaru'
import { users } from './user.test.ts'

const result = await run(users)
```

プラグイン作者は `users.blueprint()` で、グループの階層、テスト対象、middleware、実行設定・モック、ケース、宣言位置などを実行前に参照できます。通常の実行ではblueprintを取得する必要はありません。
実行器はテストからblueprintを得て、内部で実行計画を決めます。[blueprint](./docs/metadata.md)に取得できる内容と評価時点を記載しています。
テストを書くために、識別子やソース位置を別途登録する必要はありません。

失敗には宣言位置を自動で添え、条件・期待・観測・原因を構造として返します。

```text
createUser
  ✗ 保存して通知する  src/user.test.ts:42:4
    call(send).calledOnceWith
      expected: 合計1回、引数 [{ id: 'u1' }]
      actual:   合計2回
```

expectは現在の書き方と実行時のコンテキストを保つため、blueprintでは遅延処理として保持します。
全ての条件を実行前に展開する保証はありません。[宣言位置と実行結果](./docs/results.md)も参照してください。

## ドキュメント

- [はじめる](./docs/getting-started.md)
- [設計思想](./docs/concepts.md)
- [Test ビルダー](./docs/api-test.md) / [it ビルダー](./docs/api-it.md)
- [モック](./docs/api-mock.md) / [マッチャ](./docs/api-expect.md)
- [テストをグループにまとめる](./docs/grouping.md) / [middleware](./docs/middleware.md)
- [each](./docs/each.md) / [timeoutとretry](./docs/execution-options.md)
- [プラグイン向けblueprint](./docs/metadata.md) / [宣言位置と実行結果](./docs/results.md)
- [実行セマンティクス](./docs/semantics.md) / [CLI](./docs/cli.md)
- [型推論](./docs/type-inference.md) / [制約と実装状況](./docs/limitations.md)
- [用語集](./docs/glossary.md)

## 現在の状態

READMEとドキュメントは、実装する公開契約です。ビルダー・ランナー・CLIは未実装です。
このリポジトリでは、[型契約](./docs/spec/hanamaru.d.ts)と[サンプル](./docs/examples/)を次のコマンドで検証できます。

```console
tsc -p docs/spec/tsconfig.json
python3 scripts/check-docs.py
```

実行時依存0を目標とし、型チェックにはTypeScriptを使います。
