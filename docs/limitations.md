# 制約

hanamaru はゼロ依存であり、`.ts` の実行を Node.js と Bun のネイティブ機能に任せている。その結果として、動作要件とテストファイルの書き方にいくつかの制約がある。

**使える TypeScript 構文の制約は Node 由来である。** Bun のトランスパイラには同じ制約がかからない。この非対称そのものが事故の原因になるので、[Bun と Node の差](#bun-で動いて-node-で落ちる) を必ず読むこと。

このページの目的は、**実行して初めて気づく事故を減らすこと**である。検証範囲は次のとおり。使える構文・使えない構文・import の書き方は Node v24.14.0 と Bun 1.3.5 の**両方**で実際に実行して確認した。`module.registerHooks` によるモジュール解決の吸収は Node v24.14.0 でのみ確認している（Bun は `registerHooks` を実装していないため、Bun 側で確認したのは「フックなしでランタイムが解決すること」である）。

先に要点だけ挙げる。

| 確認すること | 詳細 |
|---|---|
| Node は 22.18.0 以上か | [動作要件](#動作要件) |
| tsconfig に `erasableSyntaxOnly: true` を入れたか | [使えない TypeScript 構文](#テストファイルで使えない-typescript-構文) |
| テストファイルは `node_modules` の外にあるか | [初版のスコープ外](#初版のスコープ外) |
| `.tsx` を使っていないか | [使えない TypeScript 構文](#テストファイルで使えない-typescript-構文) |
| ローカルが Bun で CI が Node になっていないか | [Bun で動いて Node で落ちる](#bun-で動いて-node-で落ちる) |
| 型チェックを `tsc --noEmit` で別途走らせているか | [初版のスコープ外](#初版のスコープ外) |

import の書き方は変更不要である。プロジェクトの通常の書き方のままでよい。ただし機構は Node と Bun で異なる。**Node では hanamaru が `module.registerHooks` で介入して吸収し、Bun ではランタイム自身が解決する。** 結論は同じで、違うのは機構だけである。詳細は [import の書き方](#import-の書き方) を参照。

## 動作要件

| 項目 | 値 | 理由 |
|---|---|---|
| Node.js | **22.18.0 以上** | type stripping の無フラグ化（22.18.0）と `module.registerHooks`（22.15.0）の両方を満たす最小バージョン |
| Bun | 1.3 以上 | ネイティブ TS 変換 |
| TypeScript | **5.4 以上** | `NoInfer` を使うため |

### Node 22.18.0 という下限の内訳

2 つの Node 機能が必要で、それぞれ利用可能になったバージョンが異なる。両方を満たす最小バージョンが 22.18.0 である。

| 必要な機能 | 用途 | 利用可能になったバージョン |
|---|---|---|
| type stripping（フラグ不要） | `.ts` ファイルをそのまま実行する | 22.18.0 |
| `module.registerHooks` | モジュール解決に介入し、import の書き方を吸収する | 22.15.0 |

22.15.0 以上 22.18.0 未満では type stripping にフラグが必要なので、hanamaru の下限は 22.18.0 になる。

type stripping は Node v24.12.0 / v25.2.0 で Stability 2 (Stable) に昇格している。実験的機能ではない。

TypeScript 5.4 という下限は `NoInfer` の 1 点による。理由は [型推論](./type-inference.md) を参照。

## テストファイルで使えない TypeScript 構文

**この節はすべて Node の制約である。Bun ではここに挙げた構文がすべて動いてしまう。** その非対称が事故を生むので、[Bun で動いて Node で落ちる](#bun-で動いて-node-で落ちる) まで必ず読むこと。

Node のネイティブ type stripping は、型を空白に置換するだけの変換である。トランスパイルではないため、**ランタイムコードを生成する構文**が使えない。

### 使えないもの（Node）

| 構文 | エラー |
|---|---|
| `enum E { A }` | `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` |
| `const enum E { A }` | 同上 |
| `namespace N { export const x = 1 }` | 同上（値を持つ namespace のみ。型だけの namespace は動く） |
| parameter properties `constructor(private x: number)` | 同上 |
| `import fs = require('node:fs')` | 同上 |
| デコレータ（レガシー / TC39 標準とも） | `SyntaxError` |
| `.tsx` ファイル | `ERR_UNKNOWN_FILE_EXTENSION` |

いずれも「型を消すだけでは実行時の意味が残らない」構文である。`enum` はオブジェクトを生成し、parameter properties は代入文を生成し、デコレータは関数呼び出しを生成する。空白に置き換えるだけの変換ではこれらを表現できない。

### 動くもの（Node / Bun 共通）

実測で確認済み。

| 構文 |
|---|
| `type` / `interface` |
| 型注釈 |
| ジェネリクス |
| `satisfies` |
| `as const` |
| `import type` |
| `abstract class` |
| 関数オーバーロード |
| 型のみの `declare namespace` |
| `.mts` |

まとめると、次のようなテストファイルはそのまま動く。

```ts
import type { User, CreateUserInput } from './user.ts'
import { Test } from 'hanamaru'
import { createUser, userRepository, mailService } from './user.ts'

const fixture = {
  input: { name: 'Alice' },
  saved: { id: 'u1' },
} as const satisfies { input: CreateUserInput; saved: User }

export const users = new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves(fixture.saved))
  .mock(mailService, 'send', m => m.resolves(undefined))
  .it('保存して通知する', t => t
    .args(fixture.input)
    .expect(e => [
      e.result.toEqual(fixture.saved),
      e.mock(mailService, 'send').calledOnceWith(fixture.saved),
    ]))
```

`import type` / `as const` / `satisfies` / 型注釈 / ジェネリクスはすべて型を消すだけで実行時の意味が変わらない構文なので、type stripping と相性がよい。通常の型レベルの記述で困る場面はほとんどない。

### `--experimental-transform-types` は削除された

以前の Node には、`enum` などを含む完全な変換を行う `--experimental-transform-types` フラグが存在した。**このフラグは Node 26.0.0 で代替なしに削除された。**

したがって `enum` などの構文は Node では恒久的に非対応である。将来対応される見込みはない。「今はフラグが必要だがそのうち標準になる」という類の制約ではないので、回避策を前提に書くこと。

### Bun で動いて Node で落ちる

Bun は type stripping ではなく本物のトランスパイラを持っている。そのため、**上の「使えないもの」に挙げた構文は Bun ではすべて動く**。実測で全件が成功することを確認した。

| 構文 | Node | Bun |
|---|---|---|
| `enum E { A }` | 落ちる | 動く |
| `const enum E { A }` | 落ちる | 動く |
| `namespace N { export const x = 1 }` | 落ちる | 動く |
| parameter properties `constructor(private x: number)` | 落ちる | 動く |
| `import fs = require('node:fs')` | 落ちる | 動く |
| デコレータ | 落ちる | 動く |
| `.tsx` ファイル | 落ちる | 動く |

これは便利さではなく**危険な非対称**である。ローカルで `bun test` 相当の実行をしながらテストを書き、CI は Node で回す、という構成はごく普通にある。その構成では、`enum` を使ったテストがローカルでは緑になり、CI に push して初めて `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` で落ちる。落ちる場所が手元から最も遠いところに移動する。

`erasableSyntaxOnly: true` はまさにこの事故を防ぐための設定である。ランタイムが何であれ、型チェックの時点で「Node で消せない構文」を一律にエラーにする。**Bun で開発するなら、この設定はいっそう重要になる。** ランタイムが警告してくれない以上、止められるのは型チェックだけである。

### `erasableSyntaxOnly: true` を設定する

tsconfig.json に `erasableSyntaxOnly: true`（TypeScript 5.8 以降）を設定すると、上記の使えない構文をコンパイル時にエラーにできる。

```json
{
  "compilerOptions": {
    "erasableSyntaxOnly": true
  }
}
```

この設定を入れる価値は、**事故が起きる場所が前倒しになる**ことにある。

| `erasableSyntaxOnly` | `enum` を書いたとき |
|---|---|
| 設定しない（Node で実行） | `tsc --noEmit` を通過し、実行して初めて `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` で落ちる |
| 設定しない（Bun で実行） | そのまま通る。Node の CI に到達して初めて落ちる |
| `true` | ランタイムに関係なく、エディタ上で書いた瞬間に型エラーになる |

テストファイルだけでなく、テストが import するソースファイルにも同じ制約がかかることに注意する。テスト対象のモジュールが `enum` を使っていれば、それを import したテストは実行できない。プロジェクト全体に `erasableSyntaxOnly: true` を設定しておくのが確実である。

### enum の代替

`as const` オブジェクトを使う。

```ts
// 使えない
enum UserStatus {
  Active = 'active',
  Suspended = 'suspended',
}

// 代替
export const UserStatus = {
  Active: 'active',
  Suspended: 'suspended',
} as const

export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus]
```

値としての `UserStatus.Active` と、型としての `UserStatus` の両方が使える。`as const` は type stripping で問題なく動く。

## import の書き方

### Node 単体での制約

Node のネイティブ type stripping 単体では、相対 import に `.ts` 拡張子が必須である。`./dep` も `./dep.js` も `ERR_MODULE_NOT_FOUND` になる。また tsconfig の `paths` は無視される。

これは、プロジェクトのソースコードが普段どう書かれているかと衝突しやすい。多くの TypeScript プロジェクトは `./dep` または `./dep.js` で書かれており、`paths` エイリアスも使われている。

### Node では hanamaru が吸収する

hanamaru は `module.registerHooks`（Node の標準機能。追加依存なし）でモジュール解決に介入し、以下をすべて解決する。Node v24.14.0 で実測済み。

| 書き方 | 由来 |
|---|---|
| `import './dep.ts'` | Node ネイティブの書き方 |
| `import './dep.js'` | NodeNext 慣例 |
| `import './dep'` | 拡張子省略 / bundler 慣例 |
| `import '@/dep.js'` | tsconfig の `paths` エイリアス |

つまり、以下の 4 行はどれもそのまま動く（最後の 1 行は tsconfig の `paths` で `@/` を解決している場合）。

```ts
import { createUser } from './user.ts'
import { createUser } from './user.js'
import { createUser } from './user'
import { createUser } from '@/user.js'
```

**ユーザーはプロジェクトの通常のソースファイルと同じ書き方でテストを書ける。** hanamaru のために tsconfig を変更する必要はない。既存のプロジェクトにテストファイルを 1 つ足すとき、import の書き方を変える作業は発生しない。

### Bun ではランタイムが解決する

上記は Node での話である。Bun は `module.registerHooks` を実装していない。`node:module` から取得すると `undefined` になる（Bun 1.3.5 で実測）。

そもそも Bun ではフックが不要である。Bun のモジュール解決が `./dep.ts` / `./dep.js` / `./dep` / tsconfig の `paths` をすべてネイティブに解決するため、hanamaru は介入しない。上の 4 行はフックなしでそのまま動く。

結果として、ユーザーから見た書き方は Node と Bun で同じになる。**機構だけが違う。** 使える構文の方（[使えない TypeScript 構文](#テストファイルで使えない-typescript-構文)）とは違い、import の書き方には Node と Bun の非対称が無い。

### スタックトレース

スタックトレースの行番号・桁番号は `.ts` の位置を正確に指す。type stripping は型を空白に置換するだけで行や桁をずらさないため、ソースマップなしで元の位置が保たれる。

失敗したアサーションや予期しない例外の報告で、エディタからそのまま該当行へ飛べる。

## 型の限界

型で捕まえられない誤りが 1 つある。**構造的に同一な別オブジェクトを `e.mock()` に渡しても型エラーにならない。** TypeScript は構造的型システムなので、同じ形の 2 つのオブジェクトは同じ型になり、オブジェクト参照そのものを型レベルのキーにすることは原理的に不可能である。このケースは実行時に「登録されていないモックを参照しています」というエラーになる。

また、未登録オブジェクトを参照したときの型エラーメッセージには既知の粗さが 2 点ある（エラー位置がマッチャ名にずれる、匿名型だと型表示が 160 文字で打ち切られる）。

いずれも詳細とコード例は [型推論 / 型の限界](./type-inference.md#型の限界) を参照。

## 初版のスコープ外

ここから先は「できないこと」の一覧だが、性質が 2 つに分かれる。混同しないこと。

### Node の制約で恒久的にできないこと

| 項目 | 理由 |
|---|---|
| `enum` / `const enum` / 値を持つ `namespace` / parameter properties / `import = require` / デコレータ | type stripping がランタイムコードを生成しないため。`--experimental-transform-types` は Node 26.0.0 で削除済み |
| `.tsx` ファイル | Node が `.tsx` を実行できない（`ERR_UNKNOWN_FILE_EXTENSION`） |
| `node_modules` の中にテストファイルを置くこと | Node が `node_modules` 内の `.ts` の実行を拒否するため。テストファイルは `node_modules` の外に置く |

これらは hanamaru の設計判断ではなく、ランタイム側の仕様である。hanamaru がゼロ依存をやめてトランスパイラを抱えない限り変わらない。

### 初版ではやらないこと

| 項目 | 現状 |
|---|---|
| 並列実行 | 行わない。単一プロセスで直列に実行する |
| watch モード | 無い |
| カバレッジ計測 | 行わない |
| モジュールモック | 無い。モックは `.mock(obj, 'method', ...)` によるプロパティ差し替えのみ |
| 型チェック | 行わない。hanamaru はテストを実行するだけ |

これらは Node の制約ではなく、初版でスコープに入れなかったものである。

型チェックについては、`tsc --noEmit` を別途実行すること。hanamaru の型設計は「コンパイル時に誤りを弾く」ことを中核に据えているので、型チェックを CI に入れて初めて価値が出る。

```console
$ tsc --noEmit && npx hanamaru
```

モジュールモックが無いことは、テスト対象の書き方に影響する。差し替えたい依存は、モジュールの内部で直接 import して呼ぶのではなく、差し替え可能なオブジェクトのメソッドとして持つ必要がある。ドキュメント全体で使っているコード例が `userRepository.save()` / `mailService.send()` というオブジェクトのメソッド呼び出しになっているのはこのためである。

## 関連

- [型推論](./type-inference.md) — 型で防げることと、防げないこと
- [CLI](./cli.md) — 実行方法と設定ファイル
- [実行セマンティクス](./semantics.md) — モックの適用順序と復元のタイミング
