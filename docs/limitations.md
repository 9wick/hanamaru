# 制約と実装状況

## 現在の成果物

このリポジトリはドキュメントを先に作っている段階である。
READMEとAPIページは、実装する公開契約を記述している。

| 対象 | 状態 |
|---|---|
| ビルダー・プラグイン向けblueprint・実行のAPI仕様 | 文書化済み |
| 公開APIの設計用型契約 | `docs/spec/hanamaru.d.ts` |
| 入門・グループ・middleware・each・実行設定のサンプルと型の負例 | `tsc -p docs/spec/tsconfig.json` で検証可能 |
| ビルダー・ランナー・CLIの実装 | 未実装 |
| npmパッケージのインストールと実行 | このリポジトリでは未検証 |
| モックの復元、middleware、失敗集約等の実行時保証 | 実装後に検証する契約 |

型検証が通ることは、実行時セマンティクスの実装が存在することを意味しない。

## 対応する環境

初版の対応目標はNode.js 22.18以上、TypeScript 5.8以上。
Nodeのtype strippingは22.18で既定有効になった。設定例では5.8で導入された `erasableSyntaxOnly` を使う。
[Nodeの公式説明](https://nodejs.org/docs/latest-v22.x/api/typescript.html)、[TypeScript 5.8](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-8.html)を参照。

Bun 1.3以上での実行も対応目標とする。Nodeと同じblueprint・実行セマンティクスを使う。
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

## blueprintの性質

TestBlueprintには実行に必要な関数や参照を保持する。JSONで往復可能とは限らない。
任意関数の内部動作や依存を完全に解析する機能も含まない。
expectは遅延した処理として保持し、blueprint取得時にはその内部のアサーション一覧まで展開しない。
expectCallsは定義時に記述子へ展開し、blueprintから対象・キー・条件を取得できる。
文脈から得る値は、その取得方法をblueprintに保持する。
[プラグイン向けblueprint](./metadata.md)を参照。

blueprintはreadonlyだが、利用者から渡されたオブジェクト内部まで複製・凍結しない。
コンテキストはnextへの追加フィールドを反映するたびに新しい入れ物へフィールドを引き継ぐが、フィールドが参照する資源や値は複製しない。
ケース間で独立した値を使うには、middleware・argsFromで生成する。

呼び出しの検証にはmock登録を要求しない。指定した参照そのものを記録対象にする。
構造が同じ別オブジェクトを間違えて指定したかどうかまでは、型で判定できない。

親のコンテキストの要求はTypeScript上の契約であり、実行時のスキーマではない。
要求は `new Test<R>()` のRだけで、供給元は指定しない。middlewareの配置から必要な時点を追跡し、その時点までに供給できるか合成時に検査する。時点の情報を広い型注釈で隠した場合は、group開始時から必要な可能性も含めて検査する。
`group` と `run` の型検査では不足を防ぐが、型チェックをしないCLIはexportされた定義の型引数を検査できない。
収集するテストファイルには親のコンテキストを要求しないルートをexportし、親のコンテキストが必要な子は探索対象外に置く。

middlewareの戻り値から後続コンテキストを推論するため、nextの完了値を返す必要がある。
`return await next(...)` のreturn忘れは型で防ぐが、nextの呼び出し回数や待機の正しさは実行時にも検査する。
finally内の早すぎる解放を型で防ぐことはできない。後処理がある場合は `return next(...)` ではなくawaitしてから返す。

## モックと呼び出し記録の範囲

両方ともオブジェクトのメソッド差し替えに限定する。モジュールモック、クロージャ内部の参照の置換は提供しない。
プロパティを経由せず保存済みの関数参照を呼ぶコードは、そのプロパティを差し替えても変わらない。
モックのために依存の渡し方を整理する必要がある場合がある。

## ケースの独立性

各caseは、他のcaseの実行有無・実行順に依存しないことを契約とします。
初版の標準実行器は直列・宣言順で実行しますが、その順序は利用者が依存できる保証ではありません。
将来のshuffle・parallel・sharding・複数process配置で順序や配置が変わっても意味が変わらないtestを前提とします。

runnerはhanamaru自身が管理するコンテキスト・mock・呼び出し記録を各attemptで作り直します。
process.env、module state、global、filesystem、外部DB等の利用者側の共有状態を自動で複製・復元する保証はありません。必要な初期化と復元はcase自身の実行境界に含めます。

順序を持つscenarioは通常case間の依存として表さず、将来のflowへ分離する方針です。
高価な環境の共有は共有資源を保持する期間の問題であり、flowとは区別します。

## 初版の実行契約

宣言位置の自動取得、構造化した失敗、各試行の結果、timeout・retry、each、mock sequence、nthの呼び出し条件を含めます。
timeout・retryはgroup、`.target()` の前後、ケースで項目ごとに継承・上書きします。middlewareの前処理期限・後処理期限は `middleware(fn, { timeout })` に持たせます。
標準CLIは期限超過後の停止を保証し、run(test)単独は同一プロセスの処理と後始末を待ちます。
未終了の処理・未完了の復元を次ケースへ持ち越しません。実装とランタイム検証はこれからです。

## 初版の実行器に含めないもの

- 並列実行、自動的な実行順変更
- watch、カバレッジ計測
- process・run単位の共有資源の管理。group単位の共有資源は `group(middleware, [children])` で管理する
- fake timers / Date（次verで検討）、呼び出しの順序・部分一致（後続）
- flow（今回の計画外）
- each専用のonly/skip/todo表記（未採用）
- signal、custom matcherの登録API、タグ・注記、snapshot
- ビルダーコールバックや任意の述語の静的解析
- 型チェックの内蔵（通常のtest scriptから `tsc` を実行する）

これらは標準の提供範囲であり、プラグインによるblueprintの利用方法を制限するものではありません。
expectの事前構造化は書き心地を保つ方式が未決です。初版は`e.ctx`を含む現行の書き方と遅延評価を契約にします。
実行時依存0は実装目標。TypeScript等の開発依存まで0という意味ではない。
