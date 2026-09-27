# hanamaru

Honoのように、短いチェーンで型を積み上げる、軽量なテストフレームワーク。
対象・モック・引数・期待を書き、完成したテストをexportしてCLIで実行します。

<!-- example: docs/examples/user.test.ts -->
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
出典: [docs/examples/user.test.ts](docs/examples/user.test.ts)

`.target()` から引数と戻り値の型が決まります。
戻り値・例外は `.expect()`、呼ばれ方は `.expectCalls()` に条件を並べます。
呼び出しの記録は自動で設定するので、検証のためにmockやspyを登録する必要はありません。
振る舞いを変えたい依存だけ `.mock(obj, key, ...)` で設定し、ケース内の同じmockで上書きできます。

## 小さく始める

純粋関数なら、対象・引数・期待だけで書けます。

<!-- example: docs/examples/math.test.ts -->
```ts
import { Test } from 'hanamaru'
import { add } from './math.ts'

export const addition = new Test()
  .target(add)
  .it('2つの数を足す', t => t.args(1, 2).expect(e => [
    e.result.toBe(3),
  ]))
```
出典: [docs/examples/math.test.ts](docs/examples/math.test.ts)

パッケージをインストールした環境で、テストファイルを指定して実行できます。

```console
npx hanamaru src/math.test.ts
```

このコマンドは、例のファイルを `src/math.test.ts` に置いた場合です。引数なしの `npx hanamaru` は `**/*.{test,spec}.ts` を探索します。型チェックを含むtest scriptは[はじめる](./docs/getting-started.md#実行環境とコマンド)を参照してください。

## 行データからケースを書く

<!-- example: docs/examples/each.test.ts -->
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
出典: [docs/examples/each.test.ts](docs/examples/each.test.ts)

eachはitと並ぶ入口です。行ごとに名前やIDを追加せず、引数・期待の型を保ってケースを並べます。
[eachの表示と実行](./docs/each.md)を参照してください。

## モックなしでも呼び出しを検証する

<!-- example: docs/examples/calls.test.ts -->
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
出典: [docs/examples/calls.test.ts](docs/examples/calls.test.ts)

この例ではsaveとsendの本物の処理を呼び、その呼ばれ方を検証します。

## 関連するテストをまとめる

<!-- example: docs/examples/group-scopes.test.ts#group -->
```ts
const userGroup = new Test()
  .mock(mailService, 'send', m => m.resolves(undefined))
  .group('ユーザー', [createTests, saveTests])
```
出典: [docs/examples/group-scopes.test.ts](docs/examples/group-scopes.test.ts)

groupで関連するテストを一つのまとまりにし、配下へ共通のmock・use・timeout・retryを適用できます。
名前は任意です。子が一つでも配列で渡します。子の設定はその子の配下だけに適用し、元の定義や兄弟へ影響しません。
グループ化と共通設定の範囲は[テストをグループにまとめる](./docs/grouping.md)を参照してください。

## group全体で資源を共有する

通常の `.use()` は各caseの各attemptを囲みます。
高価な資源を一つのgroup全体で共有したい場合は、そのgroupの子全体をmiddlewareで囲めます。

<!-- example: docs/examples/group-middleware.test.ts#group-middleware -->
```ts
export const serverTests = new Test()
  .group(middleware(async (_, next) => {
    const server = await startServer()
    try {
      return await next({ server })
    } finally {
      await server.stop()
    }
  }), [listUsers, missingPage])
```
出典: [docs/examples/group-middleware.test.ts](docs/examples/group-middleware.test.ts)

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

<!-- example: docs/examples/middleware.test.ts -->
```ts
import { Test, middleware } from 'hanamaru'
import { createDatabase, countUsers } from './database.ts'

export const userCount = new Test()
  .use(middleware(async (_, next) => {
    const db = await createDatabase()
    try {
      return await next({ db, expected: 3 })
    } finally {
      await db.close()
    }
  }))
  .target(countUsers)
  .it('ユーザー数を取得する', t => t
    .argsFrom(ctx => [ctx.db])
    .expect(e => [e.result.toBe(e.ctx.expected)]))
```
出典: [docs/examples/middleware.test.ts](docs/examples/middleware.test.ts)

middlewareは `middleware(fn, options?)` で作り、nextへ渡した値の型は後続のargsFromや`e.ctx`へ伝わります。
値を渡すだけなら `.use(middleware(async (_, next) => next({ expected: 3 })))` と書けます。
詳しくは[middleware](./docs/middleware.md)を参照してください。

## 定義したテストを実行する

日常のテスト実行にはCLIを使います。テストファイルは完成した定義をexportし、CLIが収集・実行・結果表示・終了コードを担当します。ファイル内で `run()` を呼ぶ必要はありません。

収集入口を名前で切り替えたい場合に追加する設定が[project](./docs/projects.md)です（未実装）。projectを使う場合も実行コマンドはCLIです。環境の準備・後始末はテストのmiddlewareに書きます。

### プログラムから結果を受け取る

自分のスクリプトから読み込み済みの定義を実行し、`RunResult` を処理したい場合は、ライブラリAPIの `run(test)` または `run([testA, testB])` を使います。

<!-- example: docs/examples/metadata.ts#run -->
```ts
import { run } from 'hanamaru'
import { users } from './user.test.ts'

const result = await run(users)
```
出典: [docs/examples/metadata.ts](docs/examples/metadata.ts)

`run` は設定ファイルを読まず、ファイル探索やprojectの選択を行いません。CLIとライブラリAPIの保証の違いは[実行方法の選び方](./docs/cli.md#実行方法の選び方)を参照してください。

### 失敗を確認する

失敗には宣言位置を自動で添え、条件・期待・観測・原因を構造として返します。

```text
createUser
  ✗ 保存して通知する  src/user.test.ts:42:4
    call(send).calledOnceWith
      expected: 合計1回、引数 [{ id: 'u1' }]
      actual:   合計2回
```

識別子やソース位置を別途登録する必要はありません。詳しくは[宣言位置と実行結果](./docs/results.md)を参照してください。

## ドキュメント

最初のテストを書いて実行する手順は、[はじめる](./docs/getting-started.md)を参照してください。

### テストを書く

- [Test ビルダー](./docs/api-test.md) / [it ビルダー](./docs/api-it.md)
- [マッチャ](./docs/api-expect.md) / [モック](./docs/api-mock.md)
- [行データからケースを書く（each）](./docs/each.md)
- [middleware](./docs/middleware.md) / [テストをグループにまとめる](./docs/grouping.md)

### 実行して結果を確認する

- [CLIと設定ファイル](./docs/cli.md)
- [timeoutとretry](./docs/execution-options.md)
- [宣言位置と実行結果](./docs/results.md)

### 仕様を詳しく知る

- [設計思想](./docs/concepts.md)
- [型推論](./docs/type-inference.md)
- [実行セマンティクス](./docs/semantics.md)
- [制約と実装状況](./docs/limitations.md)
- [用語集](./docs/glossary.md)

### プラグインを作る

- [プラグイン向けblueprint](./docs/metadata.md)

### 実装前の契約

以下のproject機能は未実装です。機能の契約と、その機能を使った構成例を分けて記載しています。

- [projectで実行入口を選ぶ](./docs/projects.md)
- [projectの利用例：unitとintegration/e2eを分ける](./docs/project-use-cases.md)

## 対応環境

Node.js 22.18以上、Bun 1.3以上、Deno 2.9.2以上を対象としています。TypeScriptの型契約は5.8以上を対象とします。
ランタイムごとの起動方法とTypeScriptの制約は[対応環境](./docs/limitations.md)と[CLI](./docs/cli.md)を参照してください。
