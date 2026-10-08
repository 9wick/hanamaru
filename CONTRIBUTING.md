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
| unit | Vitest | テスト対象の横の `src/<layer>/**/*.test.ts`、ルートの `eslint.config.test.ts`、`scripts/**/*.test.ts` |
| e2e | Vitest | `e2e/` |
| examples | hanamaru CLI | `docs/examples/*.test.ts` |

unitは対象モジュールをプロセス内で直接importし、blueprintの構築・実行・診断・CLI引数解析・
worker間メッセージのスキーマを検証します。`scripts/**/*.test.ts` は文書検査ツールの純関数を
同じ層で検証します。テストは実装と同じlint・型ルールの対象です。
`src/**/*.test.ts` も `npm run typecheck` と `npm run lint` が検査し、配布物には含めません。

e2eは `vite.config.ts` の `e2e-workspace` と `e2e-package` の2プロジェクトに分かれます。
`e2e/workspace-cli.test.ts` はリポジトリの `dist/cli.js` を子プロセスとして起動し、
installed packageでは構築しにくい環境固有シナリオ（node_modules構築、TDZ、worker内部の観測、
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

unitとE2Eのテストは公開APIから検証し、freezeの実装方式を参照しません。
lintと通信境界のテストは、禁止コードと不正な受信値を直接入力して検証します。
時間・スタック全文・診断参照の採番を固定せず、公開結果のフィールドを検証します。

## CI

[CI](.github/workflows/ci.yml) はpush・PR・手動実行に対応します。
Node.js 22.18.0 / 24で全検査と配布物のE2Eを実行します。
Bun 1.3.5 / latest、Deno 2.9.2 / v2.xでは同じ配布物E2Eを実行します。
Bun / Denoのjobではunitテスト・lint・型検査を重複実行しません。
OSはLinuxです。他のOSと公開npmレジストリ経由のインストールは未検証です。

## リリース手順

以下はnpmへの公開とGitHub Release作成を担当するメンテナー向けの手順です。
リリース対象の変更がmainに入り、同じコミットのCIが全て成功していることを確認します。
`package.json` / `package-lock.json` のversionと[変更履歴](CHANGELOG.md)を合わせてください。

まず依存を固定した状態で検証します。

```console
npm ci
npm run check
HANAMARU_RUNTIME=bun npm run test:package
HANAMARU_RUNTIME=deno npm run test:package
```

`test:package` はtarballを利用者プロジェクトへインストールし、公開API・型定義・CLIを検証します。
入門ガイドの最初の例を、ES Modules指定やtsconfigのないプロジェクトで `npx hanamaru` から実行できることを確認します。任意の型チェック設定を追加した `npm test` の成功・失敗も確認します。
Bun / Denoは事前にインストールしてください。対応環境の全CI jobの結果も確認します。

実際に配るtarballを作り、公開内容を確認します。次の例は0.1.0用です。

```console
release_dir=$(mktemp -d)
npm pack --pack-destination "$release_dir"
tar -tzf "$release_dir/hanamaru-0.1.0.tgz"
npm publish --dry-run "$release_dir/hanamaru-0.1.0.tgz"
npm whoami
npm owner ls hanamaru
```

tarballにJavaScript・型定義・CLIのworker・README・文書・LICENSE・第三者のライセンス表示が含まれることを確認します。
`--dry-run` はレジストリへ公開しません。ここまでの検証に加え、利用者環境での依存監査も確認してください。
開発依存の監査だけでは、bundlerで取り込むコードや利用者側の依存解決を判定できません。

公開を決定したら、確認した同じtarballを公開します。

```console
npm publish "$release_dir/hanamaru-0.1.0.tgz"
npm view hanamaru@0.1.0 version dist-tags
```

新しい一時プロジェクトで `hanamaru@0.1.0` をレジストリからインストールし、入門ガイドの `npx hanamaru` と、任意で型チェックを加えた `npm test` を再確認します。
成功後、リリース対象のコミットに `v0.1.0` タグを付け、GitHub Releaseへ変更履歴とtarballを添付します。
タグのpushや公開操作は、リリースを行う担当者の判断で実施します。


## ソースコードの配置

第一階層は責務のlayer、その下は同じ責務の中の関心で分けます。

| 配置 | 責務・探すもの |
| --- | --- |
| `src/interfaces/library/` | TestのBuilder、公開APIから内部定義への変換 |
| `src/interfaces/cli/` | 引数の解釈、pretty/JSON表示 |
| `src/application/collection/` | 登録、projectの選択、収集から実行までの手順 |
| `src/application/execution/` | 計画、attempt、middleware、retry、進捗 |
| `src/application/ports/` | Worker実行・モジュール読込・比較など、外部実装に要求する契約 |
| `src/domain/` | 定義・期待条件・実行設定・結果のモデルと妥当性 |
| `src/infrastructure/` | Vite、Worker、ファイル探索、比較ライブラリ、宣言位置の取得 |
| `src/foundation/` | 特定の業務や実行環境を知らないJavaScript値・関数・エラーの操作 |

`interfaces → application → domain → foundation` と `infrastructure → application/domain/foundation` の向きを守ります。
各layer内の参照も許可します。起動ファイル `index.ts`・`cli.ts`・`cli-worker.ts`・`execution-worker.ts` が具体実装を接続します。
内部実装からこれらの入口を逆にimportしません。`npm run lint` のESLintルールが、型参照・再export・動的importも含めて検査します。
公開設定 `Config.vite` のVite型だけは既存API互換性のためapplicationに残し、実行時のVite依存はinfrastructureに置きます。

## サービスの組み立て

サービスは `@zeltjs/core` のDIコンテナが組み立てます。`@Injectable()` を付けたクラスが
constructorの `inject()` で依存を受け取り、`@Config({ abstract: true })` の抽象クラスが
applicationからinfrastructureへ求める契約の宛名になります。実装の選択は起動ファイルが
`createRuntime({ configs })` へ具体クラスを渡して行い、`src/application` だけは宛名を書くために
`@zeltjs/core` をimportできます（domain・foundationは引き続きValibotのみ）。

scopeは1回のrunにつき1つです。CLIの親プロセスは1回の起動ごとに、収集worker・実行workerはworkerごとに、
ライブラリの `run()` は呼び出しごとにscopeを立てて畳みます。結果の表示先(`ResultPresenter`)や
実行の持ち場を開く口(`Executor`)は宛名で、繋ぎ先は各起動ファイルが `configs` で選びます。公開APIの利用者がコンテナに触ることはありません。

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
`progress.test.ts`、実物の実行サービスと連携して進捗を更新する `RunWalker` の契約は `runner.*.test.ts` に置きます。
実装同士の結果が一致することに加え、契約から定めた期待結果も確認します。

E2Eは `e2e/` に置き、ライブラリは配布された公開API、CLIはインストール済みbinを入口として検証します。
Worker間の進捗通知を保証する場合は、本番の送信・通信・受信・表示まで通します。
テスト側で通知を直接別サービスへ渡す接続は、本番の通信経路を検証したことにはなりません。
実行環境固有のシナリオはworkspaceの配布物で検証できます。

型・schema・unitテストは責務の所有者のそばに置きます。共通という理由だけで `shared.ts` や全体の `types/` に集めません。
宣言位置の取得は起動ファイルのディレクトリを基準に実装フレームを除外します。
Workerと公開APIのURLも起動ファイルで組み立てるため、内部ファイルの階層が配布物の探索に影響しません。

文書は `docs/guides/`（使い方）、`docs/reference/`（仕様）、`docs/concepts/`（考え方）で分けます。
`docs/examples/` と `docs/spec/` は実行・型検証用のソースで、文書検査は `docs/` 配下のMarkdownを再帰的に対象とします。
