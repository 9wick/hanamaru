# 開発と検証

```console
npm ci
npm run check
```

`npm run check` は型・lint・整形・ビルド・実行テスト・文書検査を実施します。
lintはVite+のOxlintと型情報を使うESLint、整形はOxfmt、ビルドはtsdownをVite+経由で実行します。
実装・型契約・文書サンプルはTypeScript 5.8.3で検証します。

TypeScriptファイルでは `any`、型アサーション（`as const` を除く）、非nullアサーション、
手書きの型述語（`is` / `asserts`）、`Function` 型を禁止します。実装には依存やネイティブAPI由来の
`any` の未検証利用とPromiseの未処理も検出します。入力はValibotまたは実際の値の種類を確認して扱い、
公開APIの型推論をキャストで補いません。`unknown` は外部入力・例外・型を消去する境界で許可し、
利用する前にスキーマまたは値の種類を検証します。既知の内部データを安易にunknownへ広げず、
検証後は具体的な型で扱います。値からリテラル型・readonlyを導く `as const` は許可します。
任意の型を指定する `as Type` と `as const as Type` は禁止します。
ESLintの無効化コメントとTypeScriptのエラー抑制も使えません。
例外は `docs/spec/*.ts` の型エラーテストだけで、説明付きの `@ts-expect-error` を許可します。
`eslint.config.test.ts` が、`as const` の許可、禁止コードの検出、抑制コメントで回避できないことを検証します。

| コマンド | 検証対象 |
| --- | --- |
| `npm run typecheck` | 型契約とドキュメントのTypeScriptサンプル |
| `npm run lint` | 実装・テスト・サンプルのlint |
| `npm run format:check` / `npm run format` | 実装・テスト・ビルド設定の整形 |
| `npm test` | ビルドしたうえでunit・e2e・examplesの全層 |
| `npm run test:unit` | ビルダー・ランナー・CLI引数・通信スキーマ・lint設定の内部契約 |
| `npm run test:e2e` | ビルドしたCLIとインストール済みパッケージでの公開契約 |
| `npm run test:package` | tarballをインストールした利用者プロジェクトでの公開APIとCLI |
| `npm run test:examples` | 公開文書のサンプルをhanamaru自身で実行した結果 |
| `npm run check:docs` | リンク・アンカー・表・コードフェンスと、README.md / docs/**/*.md の全tsブロックが例と一致すること |
| `npm run docs:sync` | 例に合わせて文書のtsブロックと、出典行がある場合はそのリンクを書き換え |

`test:e2e` / `test:package` / `test:examples` は単独実行でも先にビルドします。
`test:unit` はビルドしないため、`dist/` がなくても実行できます。

## テストの3層

| 層 | 実行系 | 置き場所 |
| --- | --- | --- |
| unit | Vitest | テスト対象の横の `packages/<package>/src/<layer>/**/*.test.ts`、ルートの `eslint.config.test.ts`、`scripts/**/*.test.ts` |
| e2e | Vitest | `e2e/` |
| examples | hanamaru CLI | `docs/examples/*.test.ts` |

unitは対象モジュールをプロセス内で直接importし、blueprintの構築・LibraryRunの実行契約・診断・CLI引数解析・
worker間メッセージのスキーマを検証します。`scripts/**/*.test.ts` は文書検査ツールの純関数を
同じ層で検証します。テストは実装と同じlint・型ルールの対象です。
`packages/*/src/**/*.test.ts` も `npm run typecheck` と `npm run lint` が検査し、配布物には含めません。

e2eは `vite.config.ts` の `e2e-workspace` と `e2e-package` の2プロジェクトに分かれます。
`e2e/workspace-cli.test.ts` はリポジトリの `dist/cli.js` を子プロセスとして起動し、
installed packageでは構築しにくい環境固有シナリオ（node_modules構築、TDZ、worker分離の観測、
定義変更の検出など）を扱います。`e2e/installed-package.test.ts` はtarballを一時プロジェクトへ
インストールし、利用者から見える公開APIとCLIだけを観測します。

examplesは文書に載せているサンプルそのものを `node dist/cli.js --ci docs/examples/*.test.ts` で
実行し、全てがpassすることを契約とします。1件でも失敗すればCLIの終了コードが非0になり、
`npm test` が失敗します。サンプルは `hanamaru` をpackage.jsonのself-referenceで解決するため、
リポジトリ内でも利用者と同じimport文のまま実行できます。

`vp test` を直接叩くとnpm scriptではなく組込みのVitestが起動します。ビルドは走らないので、
e2eは直前の `npm run build` の結果を見ます。

## 文書のサンプル

README.mdとdocs/**/*.mdの `ts` ブロックは、全て例ファイルから抜き出したものです。
例は隠した準備コードを持たない、それ自体で読める完結したファイルです。

| 種別 | 置き場所 | 検証 |
| --- | --- | --- |
| 実行する例 | `docs/examples/*.test.ts` | 型検査とhanamaru CLIでの実行 |
| 実行しない例（`run()` 呼び出し・設定ファイルなど） | `docs/examples/*.ts` | 型検査のみ |
| 型エラーになる例 | `docs/spec/*.ts` の `@ts-expect-error` を含む範囲 | 型検査 |

CLIは `registerTest` で登録された完成定義だけを収集します。実行する例ではルートを登録し、他のファイルからimportする場合にだけexportします。

ブロックには直前の行にマーカーを置きます。紐付けないブロックは理由付きで明示します。

```markdown
<!-- example: docs/examples/mock.test.ts -->              ファイル全体
<!-- example: docs/examples/mock.test.ts#calls-fake -->  名前付き範囲
<!-- example: none — 紐付けない理由 -->                  例外
```

例との紐付けと本文の同期には、この非表示のマーカーだけを使います。読者向けの出典表示は不要です。
閉じフェンスの直後に `出典: [docs/examples/mock.test.ts](examples/mock.test.ts)` の行がある場合は、
`npm run docs:sync` がリンクを更新します。出典行がない文書には追加しません。

例ファイル側では `// #region 名前` 〜 `// #endregion 名前`（`[a-z0-9-]+`、入れ子可）で
連続した範囲に名前を付けます。表示は範囲内の行そのままで、目印行の除去とインデントの調整だけを
行います。途中を飛ばす仕組みはないため、切り出せない場合は例の側を書き直します。
どの文書からも参照されない範囲・ファイルはエラーです。

文書の `ts` ブロックを直接編集しないでください。例ファイルを直してから `npm run docs:sync` を
実行します。ずれは `npm run check:docs` が `file:line` で報告します。

## ランタイムを指定した配布物の検証

```console
npm run test:package
HANAMARU_RUNTIME=bun npm run test:package
HANAMARU_RUNTIME=deno npm run test:package
```

Bun / Denoは事前にインストールしてください。指定したランタイムがない場合は失敗し、検証をskipしません。
Nodeはビルド・tarball作成・インストール・テストの進行に使います。
利用者のTypeScriptソースと配布CLIは、指定したランタイム自身で実行します。
Denoは `run --allow-all --no-prompt --node-modules-dir=manual --no-lock` で起動します。
パッケージはレジストリへ公開せず、ローカルtarballを一時プロジェクトへインストールします。
Vite等の実行時依存はnpmレジストリから取得するため、ネットワーク接続が必要です。

## 検証する公開契約

| 契約 | E2Eの観測 |
| --- | --- |
| 配布パッケージの公開入口 | `import { Test, middleware, run } from 'hanamaru'`、package.jsonのbinからのCLI起動 |
| 定義は実行せず、各attemptを独立して囲む | blueprint取得前後の副作用、groupとattemptの取得・解放、mockの復元・case上書き |
| CLIはmodule namespaceの関数exportを差し替え・復元する | 直接import・保存した参照のmock、呼び出し記録、本物への復元、Viteのaliasと関数plugin |
| contextは変更不可の入れ物で、資源の参照は保持する | 実際の変更操作、共有値の同一参照と更新 |
| matcherは不一致を失敗にし、toThrowはErrorだけを受理する | 正常・不一致・非Errorの結果、RegExp.lastIndexの保持 |
| group・each・skip・todoの結果を保持する | 階層・行・宣言位置、未実行caseの空のattempts |
| 診断は構造と内容を保持する | matcher・expected・actual、Date・RegExp・Mapの内容 |
| CLIはTS読込・設定・探索・解決を行う | 配布物へ同梱した文書サンプルの実行、設定と引数の優先順位、拡張子とpaths |
| CLIの結果と終了コード | 成功0・実行失敗1・収集エラー2、filterとonly、retryとfail-on-flaky |
| CLIは期限超過・中断後に終了する | stuck importの収集期限、非同期・同期のstuck targetの終了猶予、Ctrl+Cの終了コード130と未完了cleanup |

unitは対象の契約を実物から検証し、E2EはCLIの公開出力から検証します。freezeの実装方式を参照しません。
lintと通信境界のテストは、禁止コードと不正な受信値を直接入力して検証します。
時間・スタック全文・診断参照の採番を固定せず、公開結果のフィールドを検証します。

## CI

[CI](.github/workflows/ci.yml) はpush・PR・手動実行に対応します。
Node.js 22.18.0 / 24で全検査と配布物のE2Eを実行します。
Bun 1.3.5 / latest、Deno 2.9.2 / v2.xでは同じ配布物E2Eを実行します。
Bun / Denoのjobではunitテスト・lint・型検査を重複実行しません。
OSはLinuxです。他のOSと公開npmレジストリ経由のインストールは未検証です。

## リリース手順

[Releaseワークフロー](.github/workflows/release.yml)と[release-it設定](.release-it.json)は、pathdencyの構成をもとにしています。
GitHub Actionsからバージョンを指定して実行すると、検証後にnpm公開と `v<version>` タグの作成・pushを行います。
リリース用のコミットは作らないため、`package.json` / `package-lock.json` のversionと[変更履歴](CHANGELOG.md)を先に揃え、mainへ入れてください。同じコミットのCIが全て成功していることも確認します。

### npm側の設定

npmのhanamaruパッケージのSettingsで、Trusted Publisherを次の内容で登録します。

| 項目 | 値 |
|---|---|
| Provider | GitHub Actions |
| Organization or user | `9wick` |
| Repository | `hanamaru` |
| Workflow filename | `release.yml` |

公開にはOIDCを使います。npmの長期トークンをGitHub Secretsへ登録する必要はありません。
設定方法は[npmのTrusted Publishing](https://docs.npmjs.com/trusted-publishers/)を参照してください。

### 実行する

GitHubのActionsから **Release → Run workflow** を開き、branchに `main`、versionに `0.1.0` などの公開バージョンを指定します。

ワークフローはNode.js 24とnpm 11.21.0を使い、`npm ci` の後に `npm run release -- "$RELEASE_VERSION" --ci` を実行します。
release-itの `after:bump` で `npm run check` が動き、型・lint・format・テスト・文書検査に成功してから公開します。
`prepack` でも配布物をビルドします。同時に複数のリリースが走らないよう、ワークフローを直列化しています。
GitHub Releaseの本文や添付ファイルは、このワークフローでは作成しません。

### ローカルで公開手順を確認する

release-it 21.1.1の実行にはNode.js 22.22.2以上の22系、24.15.0以上の24系、または26以上が必要です。
hanamaruを使う側のNode.js要件は22.18以上です。

依存をインストールし、作業ツリーがクリーンな状態でdry-runを実行します。

```console
npm ci
npm run check
npm run release -- 0.1.0 --ci --dry-run
```

`--dry-run` ではversion変更・検証フック・タグ作成・pushの予定を表示し、npmは公開のdry-runを行います。公開はされませんが、`prepack` のビルドは実行します。検証フックは実行しないため、先に `npm run check` を実行してください。
公開後はレジストリ上のversionと、新しい利用者プロジェクトからの実行を確認してください。

```console
npm view hanamaru@0.1.0 version dist-tags
```

## ソースコードの配置

外部へは引き続き一つの `hanamaru` を配布し、内部をprivateなnpm workspaceに分けます。
パッケージは責務の独立性を守る単位、パッケージ内のInjectable serviceは仕事を取りまとめる単位です。

| 配置 | 所有する責務 | 依存できる内部パッケージ |
| --- | --- | --- |
| `packages/blueprint/` | Testを入口にしたテスト記述、blueprintのモデル・成立条件、宣言・登録の通知 | なし |
| `packages/module-runtime/` | module変換・読み込み、namespaceの出自、exportの差し替え | なし |
| `packages/execution/` | 計画、試行・検証・資源管理、結果、実行workerの受信 | blueprint、module-runtime |
| `packages/cli/` | ファイル選択・収集UseCase、worker監督、設定、CLIの表示 | blueprint、execution、module-runtime |
| `src/` | 公開APIと各processの起動・具体構成 | 全て |

各パッケージは `package.json` の依存・明示的な `exports` と、個別の `tsconfig.json` を持ちます。
`npm run typecheck` は全workspaceを個別に型検査したあと、公開型契約・テスト・例も検査します。
パッケージをまたぐ参照は所有パッケージのexportsだけを使い、別パッケージのsrcへの相対importは禁止です。
逆方向の依存・未公開の入口・型参照・再export・動的importも `npm run lint` が検査します。
パッケージ内では `interfaces → application → domain → foundation` と
`infrastructure → application/domain/foundation` の向きを維持します。

module-runtimeはblueprintやPlanを知りません。参照の出自とobject/keyの差し替えを提供し、
executionの `ExecutionModules` がblueprintを走査してmodule準備と計画の指紋を作ります。
実行node/caseの参照を結び直す処理もexecutionに置きます。
宣言の通知はblueprintが所有し、CLI収集と実行workerの再読込が同じ通知契約を購読します。
登録順・ファイル別の問い合わせ・未登録検出はexecutionのCollectionLogが所有します。
blueprintの通常入口はTest・resource・relation・middleware・registerTestとその型です。
内部のBuilder・JavaScript操作・例外表示はexportしません。収集/実行側はmodel、宣言通知の接続側はdeclarationsの入口を使います。
実行既定値と継承、resourceの実行時JSON contextはexecution、CLIの失敗表示はcliが所有します。

配布JSはルートでまとめてビルドし、同じprocessの定義クラス・Symbol・DI基盤を共有します。
公開入口・bin・workerのURLは従来どおりです。`scripts/declarations.mjs` がworkspaceを参照する型宣言を
同梱ファイルへの相対参照に変換するため、利用者にprivate workspaceのインストールを要求しません。

## サービスの組み立て

サービスは `@zeltjs/core` のDIコンテナが組み立てます。`@Injectable()` を付けたクラスが
constructorの `inject()` で依存を受け取り、`@Config({ abstract: true })` の抽象クラスが
applicationからinfrastructureへ求める契約の宛名になります。実装の選択は起動ファイルが
`createRuntime({ configs })` へ具体クラスを渡して行い、`packages/*/src/application` だけは宛名を書くために
`@zeltjs/core` をimportできます（domain・foundationは引き続きValibotのみ）。

AppとNode runtimeはprocessの構成入口で一度だけ起動します。パッケージのimportはAppを作りません。
CLIの親process・収集worker・実行workerはそれぞれのprocessの入口で構成し、libraryは最初のrunで起動したものを共有します。
runごとの状態は `RunContext` へ隔離し、メソッド引数にはその仕事の入力を渡します。
公開APIの利用者がコンテナに触ることはありません。

サービスのunitテストは `@zeltjs/testing/vitest` の `createTestTarget(Service, { configs, overrides })` を使います。
対象は返り値の `target`、同じDIスコープの依存は `get()` で取得し、`new` で手動構築しません。
テスト用の実装・設定は `@Config()` の派生クラスとして宣言します。サービスの依存は `inject()` で宣言し、
呼び出しごとの入力を閉じ込めるためにテスト専用のDI派生クラスを作りません。
サービス取得・入力・実行・検証はテスト本文から読めるようにし、runtimeの生成を包む独自helperやfixtureは作りません。
runtimeの終了は公式テストadapterが `afterAll` に登録します。テスト中に開いたSDK資源は `onTestFinished` で閉じます。
状態はテストごとに隔離し、別プロセスを模した送信側・受信側にはそれぞれ別のruntimeを用意します。
テスト定義のBuilder、収集ごとの値(`CollectionLog`など)、SDKの資源(`Worker`・`MessageChannel`など)は直接生成できます。

runごとに変わる入力（収集の要求・vite設定・mockの準備・実行の計画・通知の受け取り手）はConfigに載せず、
メソッド引数として渡します。1回ぶんの資源も同じで、Vite serverやmodule runtimeは
立ち上げ役(`ModuleCompilerLauncher`・`ModuleRuntimeLauncher`・`WorkerExecutionLauncher`)が
`start` で開いて持ち場(`RunningCompiler`・`RunningRuntime`・`RunningExecution`)を返し、
開かせた流れが runtime → compiler の順に畳みます。開く前に終わったrunには畳む相手がありません。

## テスト方針

基本は **Sociable Unit Test + E2E** です。テスト対象のサービスについて、事前条件・事後条件・不変条件を
先に明示し、その契約を観測できる入力と期待結果を用意します。対象を1メソッドだけに限定せず、
初期状態・状態遷移・結果の取得・再初期化など、サービス全体の契約を確認します。

unitテストでは対象と依存サービスの実物をZeltで組み立て、依存の振る舞いをmockで置き換えることを基本にしません。
具体実装の選択には本番の `@Config()` を使い、呼び出しごとの要求や通知先はメソッド引数で渡します。
依存のないサービスや純粋な関数はそのまま検証し、Sociableにするための依存や抽象化を追加しません。
mockが必要な例外では、置き換える依存と、そのテストで保証する範囲を明示します。

unitテストは責務の所有者のそばに置き、サービスの契約をDIで取得した対象から検証します。
公開 `run()` の組み立てを通してunitテストの範囲を広げません。たとえば `ProgressStore` の状態保持の契約は
`progress.test.ts`、実物の実行サービスと連携して進捗を更新する `PlanExecutor` の契約は `runner.*.test.ts` に置きます。
実装同士の結果が一致することに加え、契約から定めた期待結果も確認します。

E2Eは `e2e/` に置き、workspaceではビルド済みCLI、installed packageではインストール済みbinから呼びます。
ライブラリの直接実行は `LibraryRun` の横の `run.*.test.ts` で、公式DI adapterから取得した実物を使って検証します。
公開入口の起動・再入禁止は `src/index.test.ts`、結果のtransport schemaは `schemas.test.ts` がそれぞれ対象の横で検証します。
E2Eは内部workspaceやsrcをimportしません。stdout・stderr・終了コードと、利用者側のファイルや後処理を観測します。
JSONは公開型と独立した観測用readerで検査し、本体のschema・Mutable型を判定基準に使いません。
配布物と型宣言の検査もconsumerへのインストール・型検査・CLI実行という利用手順で検証します。
Worker間の進捗通知を保証する場合は、本番の送信・通信・受信・表示まで通します。
テスト側で通知を直接別サービスへ渡す接続は、本番の通信経路を検証したことにはなりません。
実行環境固有のシナリオはworkspaceの配布物で検証できます。

型・schema・unitテストは責務の所有者のそばに置きます。共通という理由だけで `shared.ts` や全体の `types/` に集めません。
宣言位置の取得はblueprintの公開入口とworkspaceの実装ディレクトリを基準に実装フレームを除外します。
Workerと公開APIのURLも起動ファイルで組み立てるため、内部ファイルの階層が配布物の探索に影響しません。

文書は `docs/guides/`（使い方）、`docs/reference/`（仕様）、`docs/concepts/`（考え方）で分けます。
`docs/examples/` と `docs/spec/` は実行・型検証用のソースで、文書検査は `docs/` 配下のMarkdownを再帰的に対象とします。
