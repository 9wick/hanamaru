# hanamaru

hanamaruは、TypeScriptの関数やメソッドの契約をテストするフレームワークです。

実装の手順ではなく、対象が約束する結果・状態・外部への効果を確かめます。正しいテストを書きやすくすると同時に、不適切な検証や実装への介入を、型とAPIの構造で書きにくく・書けなくすることを目指します。

テスト対象を固定し、入力と期待を分けて書きます。対象の型から引数と期待値を推論するため、型を書き直す必要はありません。純粋関数と副作用を持つ処理を区別し、副作用は実際に生じた効果を観測することを基本とします。mockと呼び出し確認は、直接観測できない場合の妥協として扱います。

この方針を具体化した[契約をテストするためのUX/DX](docs/guides/testing-contracts.md)を、APIと実行の契約にします。用途ごとに使える操作を絞り、不適切な組合せを型と実行時検証で拒否します。

テスト定義用のライブラリと実行用のCLIを提供します。定義は[`.blueprint()`](docs/reference/metadata.md)から構造化データとして取得でき、ケース一覧や独自ツールにも利用できます。

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

## 契約に合わせて検証を選ぶ

[具体的な書き方と禁止例](docs/guides/writing-tests.md)では、対象・pure/effectful・it/propertyの選択から、環境・観測・期待・登録までを示します。

targetは対象を、pure()/effectful()は特性を、it/propertyはケースの種類を選びます。省略時はpureで、pure()の明示と同じ意味です。特性はケース追加前に一度だけ宣言でき、途中で切り替えられません。

具体例はit、入力範囲に対する性質は並列のpropertyに書きます。expectはそのケース内の期待です。冪等性など複数実行の関係も性質に含み、通常のitにcallsを提供しません。

| 確かめたい契約 | 書く内容 |
|---|---|
| この入力なら、この結果になる | 入力と具体的な期待結果 |
| 入力の範囲に対して性質が成立する | 入力の範囲と、結果や観測値について成立する条件 |
| 往復すると元に戻る、二つの実行結果が関係を満たす | 宣言した対象への呼び出しと、入力・結果間の関係 |
| 保存される、メールが届く | targetを実行し、保存状態や今回のメールを観測して照合する |
| 操作を順に行うと期待した状態になる | 一つの独立したケース内の操作列と、各段階の観測 |

例えばユーザー登録なら、保存したユーザーを取得し、届いたメールの宛先と本文を確かめます。送信関数の呼び出し記録だけでは、メールが届いたことを確かめたことにはなりません。失敗時の状態や通知の有無も、targetの契約に従って検証します。

純粋関数では入力と結果の関係を確かめ、副作用用のmockや呼び出し記録を通常の選択肢にしません。一つのケースで契約の全側面を検証する必要はありません。

[複数呼び出しの関係](docs/guides/multiple-calls.md)、[期待と観測](docs/reference/api-expect.md)、[操作列](docs/guides/flow.md)で、それぞれの書き方と制約を説明します。

直接観測が困難な場合や外部障害を再現する場合には、環境が提供する[型付きの代替](docs/reference/api-mock.md)を使います。内部の任意関数は差し替え対象にできません。

## テストの準備と共通設定をまとめる

テストデータの組み合わせを並べたいときや、前後の準備・後始末、テスト間での設定の共有にも対応しています。

| やりたいこと | hanamaruの機能 |
|---|---|
| 入力と期待値の組み合わせを並べる | [each](docs/guides/each.md)：行データからケースを作る |
| 準備と後始末をまとめる | [middleware](docs/guides/middleware.md)：前処理と後始末を一緒に書く。用意した値の型は引数や期待値に伝わる |
| 複数のテストに環境や設定を共有する | [group](docs/guides/grouping.md)：配下のテストへ共通設定を適用する |
| 共有リソースの依存関係と寿命を管理する | [resource](docs/concepts/resources.md)：必要なテストだけに共有環境を用意する |
| 制限時間や再試行を指定する | [timeout・retry](docs/guides/execution-options.md)：共通設定またはケースごとに指定する |

各評価では、hanamaruが管理する環境の依存、コンテキスト、観測記録を作り直します。propertyでは生成例・縮小候補の間でも初期化します。外部DBやモジュール内の状態は自動では復元しないため、必要な初期化や後始末はmiddlewareなどに書きます。

## 実行して、失敗の理由を確認する

CLIはテストファイルを読み込み、`registerTest` で登録されたテストを実行して結果を表示します。
失敗した条件、期待値、実際の値に加えて、テストを書いたファイルと行番号を報告します。
JSON出力、対象一覧、ケースID・宣言位置による選択実行も使えます。

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

ケースは互いの実行順へ依存しません。VitestやJestとのAPI全体の互換性より、用途に合った記述と制約を優先します。詳しくは[提供範囲と保証の境界](docs/reference/limitations.md)を参照してください。

## ドキュメント

- [契約をテストするためのUX/DX](docs/guides/testing-contracts.md)（実装の受け入れ条件）
- [設計思想](docs/concepts/concepts.md)
- [具体的な書き方と禁止例](docs/guides/writing-tests.md)
- [入門ガイド](docs/guides/getting-started.md)
- [複数実行を必要とする性質を検証する](docs/guides/multiple-calls.md)
- [操作列の具体例と性質](docs/guides/flow.md)
- API：[Test](docs/reference/api-test.md) / [ケース](docs/reference/api-it.md) / [マッチャ](docs/reference/api-expect.md) / [モック](docs/reference/api-mock.md)
- [型推論](docs/reference/type-inference.md) / [実行の仕組み](docs/concepts/semantics.md)
- [プラグイン向けblueprint](docs/reference/metadata.md)
- [変更履歴](CHANGELOG.md) / [開発への参加](CONTRIBUTING.md)

MIT License。詳しくは[LICENSE](LICENSE)を参照してください。
