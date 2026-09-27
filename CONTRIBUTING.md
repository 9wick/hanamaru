# 開発と検証

```console
npm ci
npm run check
```

`npm run check` は型・lint・整形・ビルド・実行テスト・文書検査を実施します。
lintはVite+のOxlintと型情報を使うESLint、整形はOxfmt、ビルドはtsdownをVite+経由で実行します。
実装・型契約・文書サンプルはTypeScript 5.8.3で検証します。

TypeScriptファイルでは `unknown`、`any`、型アサーション（`as const` を含む）、非nullアサーション、
手書きの型述語（`is` / `asserts`）、`Function` 型を禁止します。実装には依存やネイティブAPI由来の
`any` の未検証利用とPromiseの未処理も検出します。入力はValibotまたは実際の値の種類を確認して扱い、
公開APIの型推論をキャストで補いません。ESLintの無効化コメントとTypeScriptのエラー抑制も使えません。
例外は `docs/spec/*.ts` の型エラーテストだけで、説明付きの `@ts-expect-error` を許可します。
`test/lint.test.js` が、禁止コードの検出と抑制コメントで回避できないことを検証します。

| コマンド | 検証対象 |
| --- | --- |
| `npm run typecheck` | 型契約とドキュメントのTypeScriptサンプル |
| `npm run lint` | 実装・テスト・サンプルのlint |
| `npm run format:check` / `npm run format` | 実装・テスト・ビルド設定の整形 |
| `npm run test:runtime` | ビルダー・ランナーの実行時契約 |
| `npm run test:cli` | ビルドしたCLIのファイル読込・結果・終了コード |
| `npm run test:e2e` | tarballをインストールした利用者プロジェクトでの公開APIとCLI |
| `npm run check:docs` | 文書のリンク・構造・サンプルの一致 |

`npm test` はビルドとNodeの実行テスト・E2Eを実施します。
`test:cli` と `test:e2e` は単独実行でも先にビルドします。

## ランタイムを指定した配布物の検証

```console
npm run test:e2e
HANAMARU_RUNTIME=bun npm run test:e2e
HANAMARU_RUNTIME=deno npm run test:e2e
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
| CLIはTS読込・設定・探索・解決を行う | 公開文書の全7サンプル、設定と引数の優先順位、拡張子とpaths |
| CLIの結果と終了コード | 成功0・実行失敗1・収集エラー2、filterとonly、retryとfail-on-flaky |
| CLIは期限超過・中断後に終了する | stuck importの収集期限、非同期・同期のstuck targetの終了猶予、Ctrl+Cの終了コード130と未完了cleanup |

テストは内部の関数やfreezeの実装方式を参照しません。
時間・スタック全文・診断参照の採番を固定せず、公開結果のフィールドを検証します。

## CI

[CI](./.github/workflows/ci.yml) はpush・PR・手動実行に対応します。
Node.js 22.18.0 / 24で全検査と配布物のE2Eを実行します。
Bun 1.3.5 / latest、Deno 2.9.2 / v2.xでは同じ配布物E2Eを実行します。
Bun / Denoのjobではunitテスト・lint・型検査を重複実行しません。
OSはLinuxです。他のOSと公開npmレジストリ経由のインストールは未検証です。
