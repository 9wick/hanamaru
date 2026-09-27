# 開発と検証

```console
npm ci
npm run check
```

`npm run check` は型・lint・整形・ビルド・実行テスト・文書検査を実施します。
lintはVite+のOxlintと型情報を使うESLint、整形はOxfmt、ビルドはtsdownをVite+経由で実行します。
実装・型契約・文書サンプルはTypeScript 5.8.3で検証します。

TypeScriptファイルでは `unknown`、`any`、型アサーション（`as const` を除く）、非nullアサーション、
手書きの型述語（`is` / `asserts`）、`Function` 型を禁止します。実装には依存やネイティブAPI由来の
`any` の未検証利用とPromiseの未処理も検出します。入力はValibotまたは実際の値の種類を確認して扱い、
公開APIの型推論をキャストで補いません。値からリテラル型・readonlyを導く `as const` は許可します。
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
| `npm run check:docs` | リンク・アンカー・表・コードフェンスと、README.md / docs/*.md の全tsブロックが例と一致すること |
| `npm run docs:sync` | 例に合わせて文書のtsブロックと出典行を書き換え |

`test:e2e` / `test:package` / `test:examples` は単独実行でも先にビルドします。
`test:unit` はビルドしないため、`dist/` がなくても実行できます。

## テストの3層

| 層 | 実行系 | 置き場所 |
| --- | --- | --- |
| unit | Vitest | テスト対象の横の `src/xxx.test.ts`、ルートの `eslint.config.test.ts`、`scripts/**/*.test.ts` |
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

README.mdとdocs/*.mdの `ts` ブロックは、全て例ファイルから抜き出したものです。
例は隠した準備コードを持たない、それ自体で読める完結したファイルです。

| 種別 | 置き場所 | 検証 |
| --- | --- | --- |
| 実行する例 | `docs/examples/*.test.ts` | 型検査とhanamaru CLIでの実行 |
| 実行しない例（`run()` 呼び出し・設定ファイルなど） | `docs/examples/*.ts` | 型検査のみ |
| 型エラーになる例 | `docs/spec/*.ts` の `@ts-expect-error` を含む範囲 | 型検査 |

CLIはexportされた完成定義だけを収集するため、実行する例では定義を必ずexportします。

ブロックには直前の行にマーカーを置きます。紐付けないブロックは理由付きで明示します。

```markdown
<!-- example: docs/examples/mock.test.ts -->              ファイル全体
<!-- example: docs/examples/mock.test.ts#calls-fake -->  名前付き範囲
<!-- example: none — 紐付けない理由 -->                  例外
```

閉じフェンスの直後の1行は出典行で、`出典: [docs/examples/mock.test.ts](examples/mock.test.ts)`
の形で `npm run docs:sync` が生成・更新します。

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

[CI](./.github/workflows/ci.yml) はpush・PR・手動実行に対応します。
Node.js 22.18.0 / 24で全検査と配布物のE2Eを実行します。
Bun 1.3.5 / latest、Deno 2.9.2 / v2.xでは同じ配布物E2Eを実行します。
Bun / Denoのjobではunitテスト・lint・型検査を重複実行しません。
OSはLinuxです。他のOSと公開npmレジストリ経由のインストールは未検証です。
