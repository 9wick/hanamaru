# Blueprintを保持する計画とattempt実行の分離

> この文書はnative mock方式の実装・検証履歴です。2026-09-27のユーザー承認により
> backendをVite変換へ置き換えました。現在の契約と検証結果は [vite-runtime.md](./vite-runtime.md) を参照してください。

## 状態の訂正（追加検証後）

**要求全体は未達成。本体への統合タスク672f609aを再openした。** 以下にある50テスト成功は、そのテスト範囲の結果であり、module mock方式の一般的な成立性を保証しない。

本体のprepareModuleMocksを直接使う追加検証で、Node 22.18/24.14は「Aの準備中に依存Bを先に読み込むとBのmockが効かない」「非mock対象のexport letの更新が見えなくなる」の二つを再現した。Bunでは同じ検証が通り、環境差もある。

また、moduleの場所をユーザーに明示させる必要があるという説明は早計だった。読み込みの観測とnamespaceの同一性照合による自動特定は実験で成立した。元のソースを変更せず中継moduleを生成する代替方式はNodeで追加47 attemptの期待結果が一致したが、Bunで失敗が残る。現行backendをこの代替方式へ置き換えたわけではない。

再現コマンド・成功/失敗の生データ・残る条件は、隣の実験worktreeの `experiments/module-identity/RESULTS.md` と `results-*.json` に記録する。

## 目的と範囲

利用者が現在のTest/run/CLIをそのまま使い、計画したケースと実行するケースが一致した状態で実行環境を隔離できるようにする。頭脳がblueprint・選択・retry・結果を所有し、手足へ一試行ずつ依頼する。全件のmodule mock/spy準備は最初のテストimportより前に完了する。

今回は公開APIを維持する内部変更とする。既存mock(obj,key)はmodule識別子を持たないため、module参照の内部登録と準備処理を接続点として実装し、公開module指定APIは確定しない。利用者向けdocsと公開型宣言を変更しない。直接run(definition)は既存どおり同一環境で実行する。

## 実装前の契約

事前条件:
- 定義は再評価できる。CLIが収集したファイルとexportから手足でローカル定義を得る。
- 関数・context・共有資源はworkerへ転送しない。
- 初版は直列実行、一つの実行workerをRun内で再利用する。起動は全体収集・受付検査後。
- 公開module識別子のAPIは未決。内部のmodule参照は明示URLと名前付き関数exportを用いる。

事後条件:
- 頭脳でblueprintを一度取得して保持し、filter/only/skip/todo、path、retry回数、結果の階層を決める。
- 全blueprintを再帰走査し、mockとexpectCallsのmodule対象を重複排除する。filter前の全件を各手足の初期準備へ渡す。
- 手足は準備後にファイルを読み込み、構造上の対応を検査してからreadyを返す。再評価した関数の意味の同値性や捕捉値の完全比較は行わない。
- queueの実行jobはpathとattempt番号で一意に指定する。実行側は指定attemptのみ実行し、retryの決定は頭脳が行う。
- group middlewareの前後処理は手足で一度実行し、nextの非同期コンテキスト内で子を実行する。共有資源・AsyncLocalStorage・入れ子・同じ子の別経路配置を維持する。
- group開始/終了は資源のlifetimeを管理する制御メッセージ。mock操作や関数呼び出しを独立した実行jobにしない。
- attemptごとにmock/spyを有効化・復元し、sequenceと呼び出し記録を初期化する。復元・cleanup失敗は報告して後続を停止する。
- 期限とCtrl+Cで頭脳は最新の部分結果を保持し、猶予後の強制停止時も既存RunResultと終了コードを保つ。
- Runの完了時に開始したworkerを終了・回収する。起動/再評価/通信エラーを成功や空の結果に置き換えない。

不変条件:
- group/use/argsFrom/expect/fakeは頭脳のcollectionで実行しない。
- 既存の順序、位置情報、診断、retry/timeout/中断、公開runの受付契約を保つ。
- ユーザーソースの変換、関数の文字列化とeval、worker間の生参照転送をしない。
- commit/pushを行わない。

## 検証

- 既存runtime/CLIテスト・型・lint・format・build・文書整合チェック。
- collection workerで対象を実行しないこと、実行workerの再利用、全体のonly/filter、重複名でもpathで指定できること。
- retryを頭脳が決め、手足の同じローカル定義で実行し、groupをretryごとに作り直さないこと。
- 関数を含むgroup資源、入れ子、AsyncLocalStorage、before/after失敗とtimeout、Ctrl+C、partial result。
- 内部module登録を使った直接importとin-source、別ファイル先行import、spy専用対象、失敗後の復元。
- Node 22.18 / 24とBunで実行する。未検証の構成は結果へ明記する。

## 残る論点

module参照の公開API、任意のmodule相互依存に対する準備、class/default/CJS/mutable export、他OS/ブラウザ/Deno、並列実行とworker配置最適化は本変更の保証対象に含めない。

## 実装・検証結果

CLIのcollection workerが計画・retry・結果を保持し、execution workerへpathとattempt番号を送る。実行側は一Run内で再利用する。module-referenceは公開exportに追加せず、URLが既知の内部接続点として配布物に含める。既存mock(obj,key)からmoduleを識別する問題は未解決であり、公開APIで直接importを差し替えられるようになったとは扱わない。

Bunではworker entryのトップレベルで無限の受信ループをawaitするとready後のメッセージを受信できなかった。初期化を終えてからserveを起動し、非同期の失敗は明示的に頭脳へ報告する形で解消した。

実行した検証:

| コマンド | 結果 |
| --- | --- |
| `npm run check` (Node 24.14.0) | 型・lint・format・build成功、50テスト成功、文書整合チェックerrors: 0 |
| `volta run --node 22.18.0 node --test test/*.test.js` | 50テスト成功 |
| `bun test test` (Bun 1.3.5) | 50テスト成功 |
| `npm pack --dry-run --ignore-scripts` | 成功。実行workerとmodule-referenceを含む48ファイルを確認 |
| `node dist/cli.js docs/examples/*.test.ts --reporter json` | 成功。status: passed、completion: completed |
| `git diff --check` | 成功 |
| `git diff --name-only -- docs README.md package.json` | 出力なし。利用者向け文書・package.jsonの変更なし |

追加した回帰検証は、collection中のrun受付制御、groupの関数資源とAsyncLocalStorage、retry・復元、重複名と子の再利用、定義構造の不一致、group前後の失敗、内部URL登録による直接import/in-sourceと全件mock/spy準備を対象とする。

未検証: 上記「残る論点」の構成、worker起動・通信コストの性能測定。

## 構造レビュー

目的は、計画の所有と実行環境を分離しながら、利用者のテストとmiddlewareの振る舞いを維持すること。runnerは選択とretry、execution-clientは通信、execution-workerはローカル関数と資源の実行、module-referenceはmodule準備、execution-planは再評価した定義の対応検査を担う。

| 観点 | 評価 |
| --- | --- |
| カプセル化 | mockのslotとmodule識別子は内部Mapに保持。小さい改善余地としてclient.attachがrunnerの状態フィールドを知る。状態の名前や部分結果モデルを変える際に両方の修正が必要なため、将来の拡張時はonReason/onGroupStage等の通知境界に置き換える候補。現時点の動作上の問題は検出せず。 |
| 関心の分離 | 計画・通信・実行・module準備を分離。groupの資源寿命は実行側に残す。問題なし。 |
| ドメインモデル完全性 | 構造不一致、未知のpath、不正なattempt番号、group終了順の矛盾はエラーになる。コマンドは内部coordinatorが生成する前提で、任意の外部プロトコル入力は保証しない。並列実行の導入時にはgroup所属と同時更新の検査を再設計する必要がある。 |
| 技術レイヤ間の関心の分離 | runnerはWorkerやランタイム別mock APIをimportしない。通信とnative APIをそれぞれclient/workerとmodule-referenceに閉じ込める。問題なし。 |
| 設計パターン毎の設計要件 | 頭脳だけが選択・retry・reportingを行う。手足の再評価はローカル関数を対応付けるためで、別の実行計画を選択しない。queueの実行単位はattempt。問題なし。 |
| interface設計 | runnerのattempt/group実行境界でローカル/worker実行を切り替える。公開APIと型を維持。公開module識別の入口は未決で、内部URL登録を公開APIとして扱わない。 |

内部のqueue統合という目的は達成した。既存mock(obj,key)だけで直接importを差し替えるという上位の目的は、module識別の解決が残る。
