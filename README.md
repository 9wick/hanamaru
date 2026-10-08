# hanamaru

hanamaruは、TypeScriptの関数やメソッドをテストするフレームワークです。

テスト対象を選び、引数と期待を分けて書くことで、「何を渡すとどうなるはずか」がそのまま読み取れます。テスト対象の型から引数や期待値の型が決まるため、テスト側で型を書き直すことなく、書き間違いや実装変更のズレに気づけます。

テスト定義は[`.blueprint()`](docs/reference/metadata.md)で構造化データとして取り出せます。階層構成、モック、呼び出し条件、関数参照などが含まれており、テスト対象を実行せずにケース一覧を書き出したり、独自ツールやプラグインから利用したりできます。

単体関数から依存を持つ処理まで使えます。テスト定義用のライブラリと、実行用のCLIを提供します。

## テスト対象の型を、そのまま使う

たとえば `add(a: number, b: number): number` をテストする場合、次のように書けます。

<!-- example: docs/examples/math.test.ts -->
```ts
import { Test, registerTest } from 'hanamaru'
import { add } from './math.ts'

export const addition = new Test()
  .target(add)
  .it('2つの数を足す', t => t.args(1, 2).expect(e => [
    e.result.toBe(3),
  ]))

registerTest(addition)
```

`.target(add)` に渡した関数から、`.args()` の引数と `e.result` の期待値の型が決まります。引数や戻り値の型をテスト側で書き直す必要はありません。`.args('1', 2)` や `e.result.toBe('3')` のような書き間違いは、エディタやTypeScriptの型チェックで見つかります。非同期関数も同じ書き方で扱え、エラーやrejectは `e.error` で確かめられます。

`registerTest` はCLIで実行するテストを登録する関数です。`add` の実装を含む例は[入門ガイド](docs/guides/getting-started.md#最初のテスト)を参照してください。

## 戻り値と、依存の呼ばれ方を確かめる

戻り値に加えて、依存先のメソッドがどう呼ばれたかも確かめられます。

<!-- example: docs/examples/user.test.ts -->
```ts
import { Test, registerTest } from 'hanamaru'
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

registerTest(users)
```

`.expect()` は戻り値や例外を、`.expectCalls()` は依存メソッドの呼び出し回数や引数を確かめます。個別にspyを登録する必要はありません。振る舞いを変えたい依存には `.mock()` を使い、ケースごとに上書きもできます。

この例では保存処理をモックに置き換え、通知処理は本物を呼んで記録しています。
**呼び出しの記録だけでは、本物の処理は止まりません。** DB更新や外部への通知を避けたい場合は、その依存もモックに置き換えてください。
対象と依存の実装例は[モックの例](docs/guides/getting-started.md#モックを使う)を参照してください。

## テストの準備と共通設定をまとめる

テストデータの組み合わせを並べたいときや、前後の準備・後始末、テスト間での設定の共有にも対応しています。

| やりたいこと | hanamaruの機能 |
|---|---|
| 入力と期待値の組み合わせを並べる | [each](docs/guides/each.md)：行データからケースを作る |
| 準備と後始末をまとめる | [middleware](docs/guides/middleware.md)：前処理と後始末を一緒に書く。用意した値の型は引数や期待値に伝わる |
| 複数のテストに同じモックや設定を使う | [group](docs/guides/grouping.md)：配下のテストへ共通設定を適用する |
| 共有リソースの依存関係と寿命を管理する | [resource](docs/concepts/resources.md)：必要なテストだけに共有環境を用意する |
| 制限時間や再試行を指定する | [timeout・retry](docs/guides/execution-options.md)：共通設定またはケースごとに指定する |

各試行では、hanamaruが管理するモック、コンテキスト、呼び出し記録を作り直します。外部DBやモジュール内の状態は自動では復元しないため、必要な初期化や後始末はmiddlewareなどに書きます。

## 実行して、失敗の理由を確認する

CLIはテストファイルを読み込み、`registerTest` で登録されたテストを実行して結果を表示します。
失敗した条件、期待値、実際の値に加えて、テストを書いたファイルと行番号を報告します。
JSON出力や、コードから直接結果を受け取る `run(test)` APIも使えます。

- [CLIと設定](docs/reference/cli.md)：ファイル指定、CIでの実行、出力形式
- [project](docs/guides/projects.md)：unit・integrationなどの名前で読むファイルを選ぶ
- [実行結果](docs/reference/results.md)：失敗の情報と各試行の結果

## インストール

```console
npm install --save-dev hanamaru
```

テストの実行は `npx hanamaru` です。既定では `**/*.{test,spec}.ts` を探し、`registerTest` で登録されたテストを実行します。
最初のテストから実行までの手順は[入門ガイド](docs/guides/getting-started.md)を参照してください。

CLIはTypeScriptコードを変換して実行します。CLI自体は型チェックを行わないため、型チェックには既存のTypeScript環境を使ってください。

## 対応環境と提供範囲

Node.js 22.18以上、Bun 1.3以上、Deno 2.9.2以上に対応しています。型チェックにはTypeScript 5.8以上を使います。BunやDenoでの起動方法は[CLI](docs/reference/cli.md)を参照してください。

v0.1.0ではテストを直列に実行します。並列実行・watchモード・カバレッジ計測・snapshot・fake timersは提供していません。VitestやJestと一部共通するマッチャ名はありますが、API全体の互換性はありません。モックの対象にできる参照など、詳しい範囲は[制約と実装状況](docs/reference/limitations.md)を参照してください。

## ドキュメント

- [入門ガイド](docs/guides/getting-started.md)
- [複数の呼び出しで契約をテストする](docs/guides/multiple-calls.md)
- [シナリオ全体を検証するflow](docs/guides/flow.md)（未実装・設計中）
- API：[Test](docs/reference/api-test.md) / [ケース](docs/reference/api-it.md) / [マッチャ](docs/reference/api-expect.md) / [モック](docs/reference/api-mock.md)
- [型推論](docs/reference/type-inference.md) / [実行の仕組み](docs/concepts/semantics.md)
- [プラグイン向けblueprint](docs/reference/metadata.md)
- [変更履歴](CHANGELOG.md) / [開発への参加](CONTRIBUTING.md)

MIT License。詳しくは[LICENSE](LICENSE)を参照してください。
