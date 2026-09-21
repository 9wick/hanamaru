# hanamaru

型安全・宣言的・ゼロ依存の TypeScript テストフレームワーク。自前のランナー CLI を持つ。

一行で言うと、テストを「手続き」ではなく**値**として書く。`new Test()` はテストを実行しない。実行可能なデータ構造を組み立てて返すだけ。Hono が `export default app` でアプリを値として扱うのと同じ構造。

## 何が違うのか

### 1. 宣言的なモック

`.mock()` で依存の挙動を宣言し、`.expect()` で呼ばれ方を検証する。「モックを作る」「呼び出しを記録する」「後から記録を読む」という手続きを書かない。

```ts
.mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
.expect(e => [
  e.mock(mailService, 'send').calledOnceWith({ id: 'u1' }),
])
```

### 2. 型による未登録検出

`.mock()` していないモックを `.expect()` で参照すると、実行前にコンパイルエラーになる。

```ts
new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .it('...', t => t.args({ name: 'Alice' }).expect(e => [
    e.mock(mailService, 'send').calledTimes(1),
    //     ^^^^^^^^^^^ 型エラー: このオブジェクトは .mock() されていない
  ]))
```

`.mock()` を呼ぶたびに登録エントリが型パラメータにタプルとして積み上がり、`e.mock()` の引数の制約になる。仕組みは [型推論](docs/type-inference.md) を参照。

### 3. ゼロ依存

**実行時依存パッケージが 0**。`node_modules` に入るのは hanamaru 自身だけ。必要な機能はすべて Node の標準 API で賄っている。

| 用途 | API |
|---|---|
| `.ts` の実行 | ネイティブ type stripping |
| モジュール解決の介入 | `node:module` の `registerHooks`（Node のみ。Bun はランタイムが解決する） |
| ファイル探索 | `node:fs` の `globSync` |
| CLI 引数 | `node:util` の `parseArgs` |
| 色付け | `node:util` の `styleText` |
| 深い等価比較 | `node:util` の `isDeepStrictEqual` |
| 差分表示 | `node:assert` の `deepStrictEqual` が投げる `AssertionError.message` |

最後の1つが効いている。ゼロ依存で一番作るのが面倒な「見やすい diff」を、Node が完成品で持っている。

## 最小の例

テスト対象のコード。

```ts
// src/user.ts
export interface User { id: string }
export interface CreateUserInput { name: string }

export const userRepository = {
  async save(input: CreateUserInput): Promise<User> { /* ... */ },
  async find(id: string): Promise<User | null> { /* ... */ },
}

export const mailService = {
  async send(user: User): Promise<void> { /* ... */ },
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const user = await userRepository.save(input)
  await mailService.send(user)
  return user
}
```

テスト。

```ts
// src/user.test.ts
import { Test } from 'hanamaru'
import { createUser, userRepository, mailService } from './user.ts'

export const users = new Test()
  .target(createUser)
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
    .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
    .args({ name: 'Alice' })
    .expect(e => [
      e.error.toBeInstanceOf(Error),
      e.mock(mailService, 'send').notCalled(),
    ])
  )
```

`export` した `Test` インスタンスだけが実行される。export していない `Test` は実行されない。すべてのメソッドはイミュータブルで新しいビルダーを返すため、別ファイルから import して派生を作れる。

## 実行する

```console
$ npx hanamaru
```

アサーションは1つ落ちても後続を評価し、失敗をまとめて報告する。「結果も違うし通知も飛んでいない」が一度の実行で分かる。

```console
✗ 保存して通知する

  2 件のアサーションが失敗しました

  [1] result.toEqual
      - expected: { id: 'u1' }
      + actual:   { id: 'u2' }

  [2] mock(mailService.send).calledOnceWith
      expected: 1 回 { id: 'u1' } で呼ばれること
      actual:   0 回
```

## インストール

```console
$ npm i -D hanamaru
```

```console
$ pnpm add -D hanamaru
```

```console
$ bun add -d hanamaru
```

## 動作要件

| 項目 | 値 | 理由 |
|---|---|---|
| Node.js | **22.18.0 以上** | type stripping の無フラグ化（22.18.0）と `module.registerHooks`（22.15.0）の両方を満たす最小バージョン |
| Bun | 1.3 以上 | ネイティブ TS 変換 |
| TypeScript | **5.4 以上** | `NoInfer` を使うため |

Node のネイティブ type stripping を使うため、テストファイルで使えない TypeScript 構文がある（`enum`、デコレータ、parameter properties など）。**これらは Bun では動いてしまう**ので、CI が Node なら tsconfig に `erasableSyntaxOnly: true` を設定すること。詳細は [制約](docs/limitations.md) を参照。

## ドキュメント

- [はじめる](docs/getting-started.md) — インストールから最初の1テストが通るまで
- [考え方](docs/concepts.md) — テストを値として扱う設計と、内部アーキテクチャ
- [`Test` ビルダー](docs/api-test.md) — `.target()` / `.describe()` / `.setup()` / `.only()` / `.skip()` / `.todo()`
- [`.it()` ビルダー](docs/api-it.md) — ケース内の `.args()` / `.argsFrom()` と組み立ての順序
- [`.mock()`](docs/api-mock.md) — モックの宣言と5つの振る舞い
- [`.expect()`](docs/api-expect.md) — アサーションの記述とマッチャ一覧
- [型推論](docs/type-inference.md) — 型で防げること、その仕組み、そして型の限界
- [実行セマンティクス](docs/semantics.md) — 1ケースの実行手順、`only` の扱い、終了コード
- [CLI](docs/cli.md) — コマンドラインオプションと設定ファイル
- [制約](docs/limitations.md) — 使えない構文、初版のスコープ外

## ライセンス

MIT
