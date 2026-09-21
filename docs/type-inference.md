# 型の契約

型は、テストの実行計画を矛盾なく組み立てるために使う。
実行結果が期待どおりかどうかは、計画を実行して検証する。

公開APIの設計用型定義は [spec/hanamaru.d.ts](./spec/hanamaru.d.ts) を正本とする。
実装・配布用の型定義ではなく、仕様をコンパイル可能な形で記述したもの。

## 段階を型にする

| 型 | 保持するもの | 次にできること |
|---|---|---|
| `Test` | 初期状態 | setup、target選択 |
| `TargetStage<C>` | コンテキスト型 | target選択 |
| `TestBuilder<F, M, C>` | 関数型・登録モック・コンテキスト | 共通設定、ケース追加 |
| `Suite<F, M, C>` | 設定済みのケース群 | ケース追加、plan取得 |
| `ItBuilder<F, M, C>` | ケースの前提 | モック設定、引数指定 |
| `ItArgs<F, M, C>` | 引数指定済みのケース | モック設定、終了の期待 |
| `ItDone` | 完了したケース | 後続操作なし |

setupを選ぶとTestに戻らず、targetを選ぶとTargetStageに戻らない。
ケースを追加するとTestBuilderに戻らない。
このため、古い型で記述したケースへ新しい設定を後付けすることはできない。

## 関数型から引数・結果を得る

- 引数: `Parameters<F>`
- 結果の期待値: `Awaited<ReturnType<F>>`
- メソッド形式の対象: `O[K]` から関数型を取り出す

`FnKeys<O>` は存在が保証された関数型の文字列キーだけを拾う。
省略可能なメソッドのundefinedを取り除いて「必ず呼べる」ことにはしない。

## setupは解決後の型を伝える

```ts
setup<S>(create: () => S, dispose?: (ctx: Awaited<S>) => void | Promise<void>): TargetStage<Awaited<S>>
```

async setupでPromiseの型がctxへ漏れない。
`targetFrom` / `mockFrom` / `argsFrom` / 期待値factory / 述語 / disposeは、同じ `C` を使う。

## 登録名からモック型を得る

`M` は登録名から関数型への対応表。

```text
{}
  → mock('save', repository, 'save', ...)
  → { save: typeof repository.save }
  → mock('send', mailService, 'send', ...)
  → { save: typeof repository.save; send: typeof mailService.send }
```

`e.mock(name)` は `keyof M` の名前だけを受け付ける。
呼び出し引数はその名前に対応する関数の `Parameters` になる。
`override` も同じ対応を使い、対象の型を変えずに振る舞いを置き換える。

登録名は単一の文字列リテラルに限定する。
`string` や複数候補のunionを登録名にすると、実際には1つだけ登録した名前を型が複数登録と見なすため受け付けない。

`mockFrom` のselectorから型を推論するときは、キー・振る舞いからの逆向きの推論を `NoInfer` で止める。
ケース内の追加は、そのケースのMだけを伸ばす。次のケースに登録が漏れない。

## 正常系と例外系の型

`SuccessExpect` はresultとmockを持ち、`FailureExpect` はerrorとmockを持つ。
各終端から生成する計画も、`outcome.kind` に応じたアサーションだけを持つ。

```ts
expect(build?: (e: SuccessExpect<F, M, C>) => Assertions): ItDone
expectError(build?: (e: FailureExpect<M, C>) => Assertions): ItDone
```

`Assertions` は `readonly [Assertion, ...Assertion[]]`。
コールバックの空配列・真偽値・マッチャ呼び忘れを防ぐ。
`Assertion` と `ItDone` はそれぞれ固有のブランドを持つ。

## 検証する誤操作

[型の負例](./spec/type-errors.ts)には `@ts-expect-error` を置き、誤操作が通ってしまった場合も検証を失敗させる。

| 誤操作 | 保護 |
|---|---|
| targetの再指定、target後のsetup | 段階型 |
| setupの再指定、ケース後の共通mock追加 | 段階型 |
| targetなしのケース追加、未完成のplan取得 | 段階型 |
| 引数の型違い、引数の二度指定、引数なしのexpect | 関数型と段階型 |
| 正常系でerror、例外系でresultを参照 | 期待の型の分離 |
| 空のアサーション配列、マッチャ呼び忘れ | 非空タプルとブランド |
| 終端後の操作、ケース終端のreturn忘れ | 終端型 |
| 未登録モック参照、名前の再登録、未登録override | 登録名の型 |
| 同期メソッドへのresolves/rejects | 戻り値型 |
| 定義中のe.ctx参照 | 生のctxを公開しない |
| 省略可能なメソッドをtargetに指定 | FnKeys |

正常な入門例、再利用例、async setup、mockFrom、文脈由来の期待値も同時に型チェックする。

```console
tsc -p docs/spec/tsconfig.json
```

## 保証の境界

型で識別できないものは定義時・実行時に検査する。

- 異なる名前が同じオブジェクトの同じプロパティを指すこと
- プロパティdescriptorの書き換え可否、実体が関数かどうか
- ケースIDの重複、空文字、不正な回数・位置
- 別ケースから取り出した終端値を使い回すこと

`any`、型アサーション、型チェックしないJavaScriptは型の制約を迂回できる。
readonlyも、利用者が渡したオブジェクト内部の不変性を保証しない。

union型の関数・メソッドキー、オーバーロード、ジェネリック関数では、`Parameters` / `ReturnType` により引数と戻り値の関係が弱くなる場合がある。
必要なシグネチャの型付きラッパーをtargetとして渡す。
型で捕まえられない誤りを一つに限定したり、全ての実行時エラーを防げるとはしない。

このリポジトリでの型検証はTypeScript 5.8.3を使用。
他のバージョンやエディタでのエラーメッセージは未検証。
