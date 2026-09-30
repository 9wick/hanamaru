# import変換と共通runnerの成立性検証

> 2026-09-24の実験記録。当時の実験worktreeにあった `CONTRACT.md` と `RESULTS.md` を一つにまとめたものです。
> runnerスクリプト（`*.mjs`、`matrix.py`）と生ログ（`results-*.json`）は保存していません。
> 本文中の作業ディレクトリ・隣接worktree・再現コマンドは現在のリポジトリでは成立せず、当時の条件の記録として残しています。

## 目的

通常のTest.target(calc)/mock(namespace, key)から直接importした依存を差し替え、
頭脳のblueprintを正本として手足workerへattemptを配送する。
Node/Bun/Denoで同じfixtureを実行し、環境やimport形式による反例を隠さない。

## 実装前の契約

- 既存module-identityの12 fixture・47 attemptを変更せず再利用する。
- 手足workerの対象コード評価前に、頭脳が抽出した全mock/spy対象を準備する。
- 頭脳でmockは有効化しない。fake関数やblueprintの関数をworkerへ転送しない。
- 頭脳だけが実行対象・retry・reportingを決める。手足の再評価はローカル関数を得るため。
- workerへ送る定義の構造を照合し、不一致は実行失敗とする。
- 元ソースは変更しない。Viteの既存ESM変換器・ModuleRunnerを再利用する。
- mockのためのnode:module登録hookやBun.plugin/mock.moduleは使用しない。
- mock対象だけを安定した中継関数へ接続し、attempt後には本物へ復元する。
- 非mock exportのlive binding、class identity、import.meta.urlを保つ。
- 循環、ロード時呼び出し、捕捉した関数、alias/reexport、package import、TS、CJSを比較する。
- 失敗や未対応をskip/fallbackで合格にしない。唯一の既存intentional-failureは復元を検証するため。
- 各runtimeで頭脳と手足を動かす。変換サーバーに別runtimeが必要ならその制約を明示する。
- 実験で成立した範囲と本体統合済みの範囲を区別する。公開API/docと本体ソースは変更しない。

## 作業範囲

experiments/import-transform/**。既存fixtureと隣のhanamaru-attempt-queue/src/**は読み取りのみ。
現在のworkspaceにあるVite 8.3.0を使用し、再現手順に依存関係を記録する。

## 比較

Node 24.14 / 22.18、Bun 1.3.5 / 1.4.2、Deno 2.9.2。
全コマンド・結果・stderrを保存し、失敗のあるmatrixは終了コード1を返す。

## 初期matrix後に確認する未解決の懸念

- 中継関数名を失うと頭脳と手足のtarget名が変わる。名前・引数数・捕捉参照を維持する。
- 定義時だけでなくattempt実行中の計算specifier importにもmockを適用する。
- 元から存在する通常オブジェクトのmockも引き続き実行できる。
- retryの判定・回数は頭脳が決め、同じworker内のローカルfakeを使用する。
- 本物のESMと比較し、循環内の初期化前参照や存在しないnamed exportの例外を消さない。
- 追加チェックで差が出たら、既存fixture成功と区別して記録する。

## 実験結果

**直接importのmockとattempt配送は5環境で成立した。ただし元のESMと異なる例外挙動があり、本体採用完了とはしない。**

### 実装したもの

- Vite 8.3.0のESM変換器とModuleRunnerを使用。mockのためのNode loader hook、Bun plugin/mock.moduleは使用しない。
- compiler.mjsは変換をキャッシュし、頭脳と手足へ同じ変換結果を渡す。未実行の動的importは要求時に処理する。
- 頭脳で本物を使ってTest定義を評価し、実際のcollectBlueprints/createPlanでblueprintを収集。
- runnerがnamespace objectとmodule IDの対応を保持するため、mock対象のURLをユーザーに書かせない。
- blueprintから全mock/spy対象を抽出してworkerDataへ格納。fake関数は転送しない。
- 手足で全件の中継設定を準備してからTest定義を再評価。構造を頭脳の計画と照合する。
- 頭脳のrunPlanがケースpath/attempt番号を送り、手足のexecuteAttemptが実行・mock/spy・復元。頭脳がretry/reportingを行う。
- 中継には関数Proxyを使用し、関数名・length・constructabilityと捕捉した関数参照を維持する。
- 非mock exportの参照は元のexportsへ委譲する。フレームワーク自身とCJS moduleは明示的にnative読み込みとする。
- 変換サーバー・頭脳・手足をそれぞれ選択した同じruntimeで実行した。Deno/Bunで変換だけNode subprocessへ逃がしてはいない。

本体のsrc/**、既存fixture、公開API、user docsは変更していない。実験は隣のhanamaru-attempt-queueの未commit runner実装を使用している。

### 再実行

作業ディレクトリ: `/workspaces/github.com/9wick/hanamaru-module-mock-poc`

依存: `../hanamaru=docs-glossary-contracts/node_modules/vite` にあるVite **8.3.0**を利用する。dependencies.mjsにパスを明示し、異なるバージョンなら失敗する。既存module-identity/node_modules/identity-fixtureのsymlinkも再利用する。Node22はVolta、Bun1.4.2はnpxのローカルキャッシュ/取得を利用し、既存Bunのインストールを置換しない。

```sh
python3 experiments/import-transform/matrix.py base
python3 experiments/import-transform/matrix.py extra
python3 experiments/import-transform/matrix.py semantics
```

単独実行例:

```sh
node experiments/import-transform/verify.mjs external-package-suites.mjs
bun experiments/import-transform/verify.mjs external-package-suites.mjs
deno run -A --node-modules-dir=manual experiments/import-transform/verify.mjs external-package-suites.mjs
node experiments/import-transform/semantics.mjs
```

### 結果

| runtime | baseのコマンド | extraのコマンド | 実行case / attempt | semanticsのコマンド |
| --- | ---: | ---: | ---: | ---: |
| Node 24.14.0 | 12/12成功 | 1/1成功 | 54 / 55 | 失敗 |
| Node 22.18.0 | 12/12成功 | 1/1成功 | 54 / 55 | 失敗 |
| Bun 1.3.5 | 12/12成功 | 1/1成功 | 54 / 55 | 失敗 |
| Bun 1.4.2 | 12/12成功 | 1/1成功 | 54 / 55 | 失敗 |
| Deno 2.9.2 | 12/12成功 | 1/1成功 | 54 / 55 | 失敗 |

- `base`: **60/60コマンド成功、終了コード0**。既存12 fixture・47 attemptを無変更で比較。
- `extra`: **5/5コマンド成功、終了コード0**。7 case・8 attempt/環境。
- `semantics`: **0/5コマンド成功、終了コード1**。各環境で2つの意味の不一致を検出。
- 合計: 最終比較70コマンドのうち65成功、5失敗。mock/queue側は合計270 case・275 attemptの期待結果が一致。
- 意図的な失敗caseとretryの初回失敗は期待どおり。すべてのattemptがpassedという意味ではない。

生データはresults-base.json / results-extra.json / results-semantics.jsonにstdout・stderr・コマンド・終了コードごと保存。通常のmock比較65コマンドのstderrは空。

#### 確認できたこと

直接named/default import、namespace、alias、reexport、helper経由のmock、in-source target、TS、package自己参照、node_modules経由、CJSからのnamed import、top-level await、循環と循環内のロード時呼び出し、非mockのlive bindingとclass identity、import.meta.url、非cloneable export、spy、失敗後の復元、worker再利用。

追加でattempt中の計算specifier import、引数の同名shadowing、object shorthand、関数参照の同一性、名前・引数数、strict this、arrowの非constructability、通常オブジェクトのmock、頭脳によるretryを確認。

初期版は中継を`function dispatch`としたため、target名が変わって頭脳と手足の構造照合に失敗した。期待値を緩めず、元関数のProxyへ変更。初回の45/60成功・15失敗もresults-initial.jsonに保存している。results-matrix.jsonは追加検証前の60/60成功の記録。

### 見つかった反例

#### 初期化前参照の例外が消える

fixtures/tdz-a.mjsとtdz-b.mjsは、循環依存の途中でまだ初期化されていないconstを読む。

- native ESM: ReferenceError。
- Vite ModuleRunner単体: 読み込み成功、値はundefined。
- 今回の中継runner: 同じく読み込み成功。

Viteの変換結果ではexport getter内の参照がtry/catchで包まれており、元の例外が表面化しない。

#### 存在しないnamed exportの例外が消える

fixtures/missing-export.mjsはhelpers.mjsにない`missing`をimportする。

- native ESM: SyntaxError。
- Vite ModuleRunner単体: 読み込み成功、値はundefined。
- 今回の中継runner: 同じく読み込み成功。

自作中継を外したVite単体とも比較したため、この2件は中継追加だけが原因ではない。全5環境で再現。expected failure指定で緑にせず、semanticsコマンドを失敗のまま残す。

### 目的達成の判定

部分達成。自然なTest APIから直接import mock、全件準備、worker実行、復元、retryまで同じ経路が5環境で成立した。前方式のBun package importの介入漏れ・Bun1.3.5のクラッシュは、このfixture群では発生しない。

一方、既存runnerを再利用すれば本物のESMの意味まで保てる、という仮定には反例がある。import変換という方向は実証が進んだが、**Vite8.3.0をそのまま採用する判断は保留**。本体issue672f609aは未完了のまま。

次は、例外・linkingの意味を保つ変換／runnerの補強または別実装の比較と、本体のgroup/timeout/interrupt処理への統合を分けて進める必要がある。

未検証: ブラウザ・Windows、全バージョン、条件付きpackage exports、npm依存内部のrequire経路、JSON/Wasm/ネイティブaddon、CSPでAsyncFunctionを禁止した環境、mock対象class自体の全挙動、namespaceの全reflection特性、同一module内lexical呼び出しの置換、複数worker並行、group middleware・timeout・interruptとの本体統合、性能。

この実験はViteのModuleEvaluator/EvaluatedModuleNodeとprotected directRequestを拡張している。Viteの内部状態への接続を含むため8.3.0に固定し、他バージョンの互換性を主張しない。mockに使うruntime固有loader APIは不要になったが、FS・worker・CJS等の実行環境依存まで消えたという意味ではない。

commit/pushなし。
