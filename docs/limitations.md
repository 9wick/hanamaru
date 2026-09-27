# 制約と実装状況

## 現在の成果物

このリポジトリには公開契約を記述したドキュメントと、Node.js・Bun・Deno向けの実装があります。

| 対象 | 状態 |
|---|---|
| ビルダー・プラグイン向けblueprint・実行のAPI仕様 | 文書化済み |
| 公開APIの型 | `src/api.ts` に定義し、`dist/` に型定義を生成。`docs/spec/hanamaru.d.ts` は公開APIを再export |
| 入門・グループ・middleware・each・実行設定のサンプルと型の負例 | `tsc -p docs/spec/tsconfig.json` で検証可能 |
| ビルダー・ランナー・CLIの実装 | `src/` のTypeScript実装を `strict` で型検査。`npm test` がunit・e2e・文書サンプルの3層で実行を検証 |
| unitとintegration/e2eの実行入口を選ぶproject | [利用者との契約](./projects.md)を先に文書化。`projects`・`glob`・`entry`・`--project` はAPI案で未実装、型・実行は未検証 |
| npmパッケージのインストールと実行 | ローカルtarballのインストール・型解決・CLI起動を確認。公開npmレジストリへの配布は未検証 |
| モックの復元、middleware、失敗集約等の実行時保証 | 実行テストで主な経路を検証。全ての入力・環境は未検証 |

`npm run typecheck` は内部実装と公開APIの型契約・サンプルを検査します。型検証と実行テストは別々に実施します。`npm run check` は型・lint・format・実行・文書を検証し、`vp pack` で配布物をビルドします。`npm run build` でもビルドできます。

## 対応する環境

初版の対応目標はNode.js 22.18以上、TypeScript 5.8以上。
Nodeのtype strippingは22.18で既定有効になった。設定例では5.8で導入された `erasableSyntaxOnly` を使う。
[Nodeの公式説明](https://nodejs.org/docs/latest-v22.x/api/typescript.html)、[TypeScript 5.8](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-8.html)を参照。

Bun 1.3以上での実行も対応目標とする。Nodeと同じblueprint・実行セマンティクスを使う。
Deno 2.9.2以上も対象とし、同じ公開API・blueprint・実行セマンティクスを使います。
Node.js 22.18・24、Bun 1.3.5、Deno 2.9.2で、インストールした配布物のAPIとCLIを検証しています。全ての入力・周辺環境での同等性まで保証するものではありません。
Deno 2.9.2では、配布tarballのCLIで設定なし・alias/plugin設定ありのmodule mockと復元も検証しています。Denoで全unitテストを通したという意味ではありません。

## TypeScriptの実行

CLIは内蔵のViteでTypeScriptを変換して実行します。必要な変換設定・プラグインは
[hanamaru configのvite](./cli.md#viteの設定)で指定できます。型チェックは行いません。
Nodeでファイルを直接実行して `run(definition)` を呼ぶ場合は、
[Nodeの構文制約](https://nodejs.org/docs/latest-v22.x/api/typescript.html#typescript-features)に従います。

`erasableSyntaxOnly` だけで全てのランタイム差を防げるとはしない。
対象ランタイムでの実行確認も必要になる。

## importと設定

入門例では `.ts` 拡張子、`import type`、`type: module` とNodeNextを使う。
Nodeはtsconfigのpathsによる解決を行わない。
CLIはViteの解決処理を使い、`.js` から `.ts`、拡張子省略、tsconfigの `paths` に対応します。
BunとDenoでも、同じimportが同じ対象を読むことを受入条件にする。
JSテストの同じtsconfig内のpathsも解決します。複雑なtsconfig継承は未検証です。
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

CLIでは、通常オブジェクトのメソッドと、module namespaceの関数exportを差し替え・記録できます。
直接importやimport後に保存したmoduleの関数参照も対象です。
同一module内のローカル参照、通常オブジェクトから保存済みのメソッド参照、
Viteで外部化したmodule内部のimportは置き換えません。
CommonJSはランタイム標準で読み込みます。ESMからimportした関数exportは対象ですが、CommonJS内部のrequireには介入しません。
Viteの変換を経由します。native ESMと全ての評価順序・循環依存で同等になることまでは検証していません。
`run(definition)` は既読の定義を実行するため、module namespaceの差し替えはCLIを使います。
[モックの範囲](./api-mock.md#差し替えの範囲)を参照してください。

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
未終了の処理・未完了の復元を次ケースへ持ち越しません。CLIは猶予超過後にworkerを終了し、得られた結果を中断・後処理未完了として報告します。

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
CLIの変換・実行にはVite等の実行時依存を含めます。利用者に変換器やloaderの手動起動は要求しません。
値の比較には `@vitest/expect` 5.0.2を利用し、toEqual・toMatchObjectと呼び出し引数の比較基準を揃えます。
特殊値やundefinedの扱いは[深い一致と評価](./api-expect.md#深い一致と評価)を参照してください。
