# 制約と実装状況

## 現在の成果物

このリポジトリはドキュメントを先に作っている段階である。
READMEとAPIページは、実装する公開契約を記述している。

| 対象 | 状態 |
|---|---|
| ビルダー・実行計画・実行のAPI仕様 | 文書化済み |
| 公開APIの設計用型契約 | `docs/spec/hanamaru.d.ts` |
| 入門・合成のサンプルと型の負例 | `tsc -p docs/spec/tsconfig.json` で検証可能 |
| ビルダー・ランナー・CLIの実装 | 未実装 |
| npmパッケージのインストールと実行 | このリポジトリでは未検証 |
| モックの復元、失敗集約等の実行時保証 | 実装後に検証する契約 |

型検証が通ることは、実行時セマンティクスの実装が存在することを意味しない。

## 対応する環境

初版の対応目標はNode.js 22.18以上、TypeScript 5.8以上。
Nodeのtype strippingは22.18で既定有効になった。設定例では5.8で導入された `erasableSyntaxOnly` を使う。
[Nodeの公式説明](https://nodejs.org/docs/latest-v22.x/api/typescript.html)、[TypeScript 5.8](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-8.html)を参照。

Bun 1.3以上での実行も対応目標とする。Nodeと同じ計画・実行セマンティクスを使う。
最低バージョンでの動作とNode/Bun間の同等性は、ランナー実装後に検証する。現時点の対応実績とは区別する。

## TypeScriptの実行

Nodeのネイティブtype strippingを使い、ランタイムにトランスパイラを同梱しない方針。
`enum`、値を持つnamespace、parameter properties、`import =` のように変換を必要とする構文は使わない。
`.tsx` もこの実行方式の対象外。テストから読み込む対象コードにも同じ条件がかかる。
詳細は[Nodeの構文制約](https://nodejs.org/docs/latest-v22.x/api/typescript.html#typescript-features)を参照。

`erasableSyntaxOnly` だけで全てのランタイム差を防げるとはしない。
対象ランタイムでの実行確認も必要になる。

## importと設定

入門例では `.ts` 拡張子、`import type`、`type: module` とNodeNextを使う。
Nodeはtsconfigのpathsによる解決を行わない。
`.js` から `.ts` への置換、拡張子省略、pathsによるエイリアスは、Node向けの解決処理で吸収する設計目標である。
Bunではランタイムの解決を使い、同じimportが同じ対象を読むことを受入条件にする。
これらの解決処理は未実装・未検証なので、入門例はネイティブに解決できる `.ts` 形式を使う。
[Node単体の型importとpathsの制約](https://nodejs.org/docs/latest-v22.x/api/typescript.html)と、hanamaru側で実装する互換性を区別する。

Nodeはnode_modules内のTypeScript実行も制限するため、配布パッケージはJavaScriptと型定義を含む形を想定する。
テスト側のソースはプロジェクト内に置く。

## 計画の性質

TestPlanには実行に必要な関数や参照を保持する。JSONで往復可能とは限らない。
任意関数の内部動作や依存を完全に解析する機能も含まない。
expectは遅延した処理として保持し、plan取得時にはその内部のアサーション一覧まで展開しない。
expectCallsは定義時に記述子へ展開し、planから対象・キー・条件を取得できる。
文脈から得る値は、その取得方法を実行前の計画に保持する。
[実行計画とmetadata](./metadata.md)を参照。

計画はreadonlyだが、利用者から渡されたオブジェクト内部まで複製・凍結しない。
ctxはsetupの段階ごとに新しい入れ物へフィールドを引き継ぐが、フィールドが参照する資源や値は複製しない。
ケース間で独立した値を使うには、setupまたはargsFromで生成する。

呼び出しの検証にはmock登録を要求しない。指定した参照そのものを記録対象にする。
構造が同じ別オブジェクトを間違えて指定したかどうかまでは、型で判定できない。

親ctxの要求はTypeScript上の契約であり、実行時のスキーマではない。
`group` と `run` の型検査では不足を防ぐが、型チェックをしないCLIはexportされた定義の型引数を検査できない。
収集するテストファイルには親ctxを要求しないルートをexportし、親ctxが必要な子は探索対象外に置く。

## モックと呼び出し記録の範囲

両方ともオブジェクトのメソッド差し替えに限定する。モジュールモック、クロージャ内部の参照の置換は提供しない。
プロパティを経由せず保存済みの関数参照を呼ぶコードは、そのプロパティを差し替えても変わらない。
モックのために依存の渡し方を整理する必要がある場合がある。

## 初版の実行器に含めないもの

- 並列実行、自動的な実行順変更
- watch、カバレッジ計測
- タイムアウト、強制的な処理中断
- ビルダーコールバックや任意の述語の静的解析
- 型チェックの内蔵（通常のtest scriptから `tsc` を実行する）

終了しないtargetは待ち続ける。この制約は実行器のものであり、計画の利用方法を制限するものではない。
実行時依存0は実装目標。TypeScript等の開発依存まで0という意味ではない。
