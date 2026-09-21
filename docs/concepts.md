# 設計思想

hanamaru は型安全・宣言的・ゼロ依存の TypeScript テストフレームワークです。
このドキュメントは、hanamaru が**なぜこの形をしているのか**を説明します。
個々の API の使い方は [Test ビルダー](./api-test.md)、[it ビルダー](./api-it.md)、[マッチャ](./api-expect.md) を参照してください。

## テストを「値」として書く

hanamaru の中心にあるのは、次の一点です。

**`new Test()` はテストを実行しません。実行可能なデータ構造を組み立てて返すだけです。**

```ts
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
```

このファイルを `import()` しただけでは、`createUser` は一度も呼ばれません。
`userRepository.save` も差し替えられません。
組み上がるのは「何をどう実行し、何を検証するか」を記述した値だけです。

実際に実行するのは CLI です。CLI は対象ファイルを `import()` し、
**export されている値のうち `Test` インスタンスを集めて**実行します。
export されていない `Test` は実行されません。

### だから export して再利用・派生できる

テストが値であることの直接の帰結として、テストは他のファイルから import して使えます。
そして `Test` のすべてのメソッドはイミュータブルで、新しいビルダーを返します。元のビルダーは変化しません。

```ts
import { users } from './user.test.ts'

export const usersWithDb = users.setup(() => ({ db: makeTestDb() }))
```

`usersWithDb` は `users` のすべてのケースを引き継ぎつつ、フィクスチャだけを足した別のテストです。
`users` 自身は何の影響も受けません。両方が export されていれば、両方が実行されます。

ここで起きていることは、継承でもフックの上書きでもありません。
値に関数を適用して新しい値を作っているだけです。

### Hono と同じ構造

この構造は、Hono がアプリケーションを値として扱うのと同じものです。

```ts
// Hono
const app = new Hono().get('/users', c => c.json(users))
export default app
```

`new Hono()` はサーバーを起動しません。ルーティングの定義を組み立てて返すだけで、
起動するのは外側のランタイムです。アプリが値なので、別ファイルで組み立てたものを
import して合成できます。

hanamaru の `Test` はこれと同じ位置にいます。
`new Test()` はテストを実行せず、実行の定義を返す。実行するのは CLI です。
定義が値なので、分割・合成・派生が自然にできます。

### 対比: 手続きとして書くテスト

多くのテストフレームワークでは、`describe` / `it` はその場で登録という副作用を起こします。
テストは「ファイルを読み込むと副作用で登録される手続き」であり、値ではありません。
そのため、テストを別ファイルから import して部分的に差し替えることは自然にはできません。

hanamaru はここを逆にしています。副作用を CLI 側に寄せ、ユーザーが書くのは値だけにする。
その結果として、テストの再利用が言語機能（import と関数適用）だけで成立します。

## なぜメソッドチェーンなのか

hanamaru の API がすべてメソッドチェーンになっているのは、見た目の問題ではありません。
**TypeScript の型推論の順序**に理由があります。

### コールバックの引数型は、呼び出し側が先に確定していなければならない

`.it()` や `.expect()` に渡すコールバックの引数（`t` や `e`）の型は、
TypeScript が自力で推論できるものではありません。
「このテストの対象は何か」「どのモックが登録済みか」「コンテキストの型は何か」を
**先に確定させた上で**、コールバックの引数型として与える必要があります。

チェーンはこの「先に確定させる」を構文として表現したものです。
メソッドを1つ呼ぶたびに、確定した情報がビルダーの型パラメータに書き込まれていきます。

### `.target()` が対象を確定させる

```ts
new Test().target(createUser)
```

この時点で、ビルダーの型パラメータ `F` が `typeof createUser` に確定します。
以降は `F` から次の2つが決まります。

- `.args()` の引数型 = `Parameters<F>`
- `e.result` の型 = `Awaited<ReturnType<F>>`

だから `.args({ nam: 'Alice' })` という typo が型エラーになり、
`e.result.toEqual({ id: 123 })` という戻り値の型違いも型エラーになります。
`.target()` を先に呼んでいるからこそ、後続の引数型が分かるのです。

### `.mock()` が登録を型に積み上げる

`.mock()` を呼ぶたびに、登録エントリが型パラメータ `M` にタプルとして積み上がります。

```text
TestBuilder<F, [], C>
  .mock(userRepository, 'save', ...)  →  TestBuilder<F, [{obj: UserRepository, key: 'save'}], C>
  .mock(mailService, 'send', ...)     →  TestBuilder<F, [{...}, {obj: MailService, key: 'send'}], C>
```

`e.mock(obj, key)` は、この `M` から「その obj に対して登録済みのキー」を引き出し、
`key` の制約にします。登録していないキーを参照すれば、コンパイルエラーになります。

```ts
e.mock(userRepository, 'find')   // 型エラー: find は .mock() していない
e.mock(mailService, 'send')      // OK: .mock() 済み
```

これが差別化軸の1つである「型による未登録検出」の正体です。
実行してから「そんなモックは登録されていません」と言われるのではなく、
エディタ上で、書いているその場で分かります。

### `.setup()` がコンテキストを確定させる

```ts
.setup(() => ({ db: makeTestDb() }))
```

戻り値の型が型パラメータ `C` に入り、`.argsFrom()` と `e.ctx` の型になります。
`.setup()` を呼ばなければ `C` は `{}` のままなので、`e.ctx.db` は型エラーです。

### 型を積み上げる構造が核である

`.target()` で `F` を、`.mock()` で `M` を、`.setup()` で `C` を積み上げる。
そして終端の `.expect()` で、積み上がった `F` / `M` / `C` をすべて使ってコールバックの引数型を組み立てる。

この「型を積み上げる」構造が hanamaru の核です。
チェーンという形は、その積み上げに順序を与えるための必然的な帰結です。

型パラメータの実際の定義、`NoInfer` が必要な理由、型で防げることの一覧、
そして型システムの限界については [型推論](./type-inference.md) で詳述します。

## なぜアサーションが配列なのか

`.expect()` のコールバックは、アサーションの**記述オブジェクトの配列**を返します。

```ts
.expect(e => [
  e.result.toEqual({ id: 'u1' }),
  e.mock(mailService, 'send').calledOnceWith({ id: 'u1' }),
])
```

ここで重要なのは、**マッチャは呼ばれた時点では何も検証しない**ことです。
`e.result.toEqual({ id: 'u1' })` は「result が `{ id: 'u1' }` と深く等しいことを検証せよ」という
記述を返すだけです。実際の評価はフレームワークが行います。

### 失敗を集約できる

検証をフレームワーク側に集めた結果、hanamaru は**アサーションを全部評価します**。
1つ落ちても後続を評価し、失敗をまとめて報告します。

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

「結果も違うし、通知も飛んでいない」が**一度の実行で**分かります。

マッチャがその場で例外を投げる設計であれば、最初の失敗で関数を抜けてしまうため、
2つ目以降の状態は分かりません。直して実行し、また落ちて、また直す、という往復が発生します。
アサーションを値にして配列で返すという形は、この往復をなくすためのものです。

### 記述が値であることの一貫性

テスト全体が値であるのと同じ理屈が、アサーションの粒度でも効いています。
`.expect()` が返すのは「何を検証したいか」という宣言であり、検証という手続きではありません。
評価するのは engine の仕事です。

マッチャの一覧と各マッチャの意味は [マッチャ](./api-expect.md) を参照してください。

## なぜモックがオブジェクトのメソッド差し替えに限定されているのか

hanamaru のモックは `.mock(obj, 'method', ...)` の1形式だけです。
**モジュールモック（vitest の `vi.mock` 相当）を持ちません。**

これは機能が足りていないのではなく、意図的な範囲の設定です。

### モジュールモックを持たないと何が起きないか

モジュールモックを提供するなら、ESM のモジュール解決に手を入れ、
import されるモジュールの実体を差し替える仕組みが要ります。
ローダの階層、モジュールキャッシュ、巻き上げの順序、といった複雑さが持ち込まれます。

hanamaru はそこに立ち入りません。やることは次の3つだけです。

1. 対象オブジェクトのプロパティを退避する
2. モックの実装で差し替える
3. `finally` で元に戻す

これで済みます。差し替えているのはただのオブジェクトのプロパティであり、
モジュールシステムではありません。

### ゼロ依存を成立させている要因の1つ

この単純さは、ゼロ依存という性質を支える要因の1つです。
モジュール解決を書き換える代わりに、プロパティを1つ入れ替えて戻すだけなら、
外部パッケージに頼る理由がありません。

（hanamaru は Node でのみ `module.registerHooks` でモジュール解決に介入しますが、
それは import の書き方を吸収するためであって、モックのためではありません。
Bun にはこの介入すらありません。詳細は [制約](./limitations.md) を参照してください。）

### 裏返しの制約

正直に書きます。**依存を DI していないコードは、hanamaru ではテストしにくくなります。**

```ts
export async function createUser(input: CreateUserInput): Promise<User> {
  const user = await userRepository.save(input)
  await mailService.send(user)
  return user
}
```

このドキュメントの例が `userRepository` / `mailService` をモジュールスコープのオブジェクトとして
export しているのは偶然ではありません。差し替え可能なオブジェクトが
テストから参照できる形で存在しているから、`.mock(userRepository, 'save', ...)` が書けます。

関数の中で `new` しているもの、クロージャに閉じ込められているもの、
モジュール内部にあって export されていないものは、hanamaru からは差し替えられません。

これは hanamaru の設計上の立場です。
「テストのためにモジュール解決を曲げる」のではなく、「差し替えたいものは値として渡す・export する」。
この立場を取ることで、モックの実装は「退避して差し替え、`finally` で戻す」だけに収まり、
実行時依存は 0 になっています。

## アーキテクチャ

hanamaru は、純データを挟んで層を分けています。

```text
Test ビルダー ──▶ TestPlan ──▶ engine ──▶ TestResult ──▶ reporter ──▶ 文字列
  (純関数)       (素データ)   (副作用)    (素データ)      (純関数)
                                 ▲
                    プロパティ差し替えと finally での復元はここだけ
```

| 層 | 責務 | 副作用 |
|---|---|---|
| `builder` | チェーンを `TestPlan` に畳み込む。イミュータブル | なし |
| `loader` | モジュール解決を吸収し、テストファイルを import | I/O |
| `collector` | export された `Test` を走査 | なし |
| `engine` | モック適用 → target 実行 → アサーション評価 → 復元 | ここだけ |
| `reporter` | `TestResult` を文字列に | なし |
| `cli` | 引数解釈 → glob → 実行 → 出力 → 終了コード | I/O |

### 純データを挟むことの効果

`TestPlan` と `TestResult` という2つの素データが境界になっています。

- `builder` は「チェーン → `TestPlan`」という純関数です。入力が同じなら出力も同じで、何も起こしません
- `reporter` は「`TestResult` → 文字列」という純関数です。ファイルにも端末にも触りません

副作用は `engine` の1箇所に閉じています。
プロパティの差し替えと `finally` での復元が起きるのはそこだけです。

この形の実利は、hanamaru 自身のテストが素直に書けることです。
ビルダーの出力は値として比較でき、レポータの出力は文字列として比較できます。
テスト対象を動かすために端末やファイルシステムを用意する必要がありません。

1ケースがどの順序で実行され、`finally` で何が復元されるかは
[実行セマンティクス](./semantics.md) を参照してください。

## ゼロ依存をどう成立させているか

hanamaru の実行時依存パッケージは 0 です。
必要な機能はすべて Node の標準 API で賄っています。

| 用途 | API |
|---|---|
| `.ts` の実行 | ネイティブ type stripping |
| モジュール解決の介入 | `node:module` の `registerHooks`（Node のみ。Bun はランタイムが解決する） |
| ファイル探索 | `node:fs` の `globSync` |
| CLI 引数 | `node:util` の `parseArgs` |
| 色付け | `node:util` の `styleText` |
| 深い等価比較 | `node:util` の `isDeepStrictEqual` |
| 差分表示 | `node:assert` の `deepStrictEqual` が投げる `AssertionError.message` |

Node 専用なのは表の 2 行目だけです。Bun では `loader` がフックを入れず、
`.js` 慣例・拡張子省略・tsconfig の `paths` の解決を Bun 自身に任せます。
ユーザーから見た書き方は両者で同じで、仕組みだけが違います。
残りの API は Bun でもそのまま動きます。

### 差分表示が効いている

この表で一番効いているのは最後の1行です。

ゼロ依存でテストフレームワークを作るとき、最後まで残る難物は「見やすい diff」です。
`{ id: 'u1' }` と `{ id: 'u2' }` の違いを、色付きで、行単位で、ネストを保ったまま表示する。
これを自前で書くのは相応の量になります。

hanamaru はこれを自前で書いていません。
`node:assert` の `deepStrictEqual` は、値が一致しないとき `AssertionError` を投げます。
その `message` には、Node が生成した差分がすでに整形されて入っています。

```console
- expected: { id: 'u1' }
+ actual:   { id: 'u2' }
```

`deepStrictEqual` を try-catch で囲み、捕まえた `AssertionError` の `message` を取り出す。
それだけで、ゼロ依存のまま完成品の diff が手に入ります。

等価判定そのものには `node:util` の `isDeepStrictEqual` を使い、
差分の**文字列化**だけを `AssertionError.message` から得ています。

### 色付けとファイル探索も標準 API で足りる

`node:util` の `styleText` が色付けを、`node:fs` の `globSync` がファイル探索を、
`node:util` の `parseArgs` が CLI 引数の解釈を担当します。
いずれも外部パッケージを入れる理由がなくなった領域です。

そして `.ts` ファイルの実行は、Node のネイティブ type stripping が行います。
トランスパイラを同梱する必要がありません。

ゼロ依存は目標として掲げたものではなく、
「モジュールモックを持たない」「Node の標準 API で足りる」という2つの判断の結果として成立しています。

## 関連ドキュメント

- [Test ビルダー](./api-test.md) — `Test` の完全な API リファレンス
- [it ビルダー](./api-it.md) — `.it()` の中で使うビルダー
- [マッチャ](./api-expect.md) — `.expect()` で使えるマッチャの一覧
- [型推論](./type-inference.md) — 型パラメータの仕組みと限界
- [実行セマンティクス](./semantics.md) — 1ケースの実行順序と終了コード
- [CLI](./cli.md) — コマンドラインオプションと設定ファイル
- [制約](./limitations.md) — 動作要件と使えない構文
