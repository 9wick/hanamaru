# Viteを内蔵した収集・実行の契約

## 目的

利用者が通常のimportと既存のTest APIで直接import依存をmock/spyできる。
変換器、loader、事前ビルドの起動を利用者に要求しない。
必要なalias/pluginは `defineConfig({ vite: { ... } })` で指定する。

## 実装前の契約（2026-09-27）

- CLIはconfigなしでJS/TSを収集・実行する。CLI引数の優先順位を維持する。
- `vite` は任意の設定オブジェクト。Viteのalias/plugins等を渡せる。
  変換のrootは既定でcwd。Vite configは自動で二重読込せず、必要なら利用者が
  hanamaru configから既存設定をimportして渡す。watch/HMR/待受サーバーは不要。
- hanamaru自身がViteを依存として配布する。利用者がViteを別途導入しなくても実行できる。
  config内のプラグイン関数をworkerへcloneしない。頭脳が変換し同じ結果を配送する。
- 収集は本物の依存で定義だけを読む。middleware/fake/targetを実行しない。
- 頭脳がblueprint・選択・retry・reportingを所有する。全件mock/spyを準備した後に
  実行workerで定義を読み、構造照合してからpathとattempt番号で実行する。
- module namespaceの識別は内部で行い、URL指定APIを要求しない。
  fakeの有効化、spy記録、復元はattemptに属する。group資源はworker内で保持する。
- CommonJSパッケージは標準runtimeで読み込み、ESM側からimportした関数のmock/spyと復元を保つ。
  CommonJS内部のrequireには介入しない。ESMパッケージは変換対象のまま保つ。
- 関数参照、通常オブジェクトmock、非mock exportの更新、in-source testを保つ。
- Vite実験で見つかった初期化前参照・存在しないexportの例外を消さない。
  変換補正はVite生成コードに限定し、ユーザーが書いたtry/catchは変更しない。
- collection timeout、attempt timeout、interrupt、cleanup失敗、診断位置を維持する。
- `run(definition)` は既読の関数参照を実行するAPIとして維持する。
  CLIのimport介入と同等とは扱わず、直接実行の限界は文書に明記する。
- 公開configが増えるため型・利用者向け設定例を更新する。commit/pushは行わない。

## 検証計画

1. 既存のruntime/CLI・型・lint・format・build・文書検査。
2. configなしのnamed/default/namespace import、in-source、別ファイル全件準備、spyのみ、
   retry・失敗後復元、group・AsyncLocalStorage・timeout・interrupt。
3. config.viteのalias、非cloneableなplugin、tsconfig paths、configエラー。
4. 循環依存・export更新・初期化前参照・存在しないexport。
5. 配布物を別プロジェクトに導入し、設定なし・設定ありで実行する。
6. Node 22/24、Bun、DenoでCLIを実行する。未検証の組み合わせは明記する。

過去のnative mock実装・実験の判断は `attempt-queue.md` と実験worktreeに残す。
本書の契約が、過去の「変換しない」「公開型を変更しない」という制約を置き換える。

## 目的達成の確認（2026-09-27）

### 実装結果

CLIにViteの変換・module runnerを組み込み、`Config.vite` の公開型と設定例を追加した。
内部Viteはnpm alias `@hanamaru/vite` で固定バージョンを配布する。
module namespaceから識別子を記録し、全件のmock/spy準備を実行workerへ渡す。
頭脳が保持するblueprintからattemptを配送し、workerの再評価した定義は構造照合して使う。
ユーザーのplugin関数は頭脳で実行し、変換済みコードだけをworkerへ渡す。

### 目的との対応

- 通常のimport・`target(fn)`・`mock(namespace, key)` から直接import依存のmock/spyまで接続した。
  module URLの手動登録、loader指定、利用者による事前ビルドは不要。
- 配布tarballを新規projectへ導入して検証した。設定なしの構成と、別バージョンのViteが
  インストールされたalias/plugin設定ありの構成で、型検査と実行が成立した。
- 計画と実行の対応はblueprintの構造照合で検査する。任意関数の意味や捕捉値の同値性を
  証明するものではなく、テスト定義が再評価可能であるという合意した前提を維持する。
- `node testfile.ts` だけでmodule mockが成立したとはしない。import介入を伴う経路はCLI。

### 実装を通じて確認したこと

Viteの内蔵だけでは互換性を保証できなかった。生成されたexport getterがTDZ例外を消す点を
限定的に補正し、存在しないnamed exportを検査する。補正が依存するViteは固定し、回帰テストを置いた。
CommonJSパッケージの一律変換も失敗したため、packageの形式に従って標準runtimeで読み込む。
CommonJS内部のrequireや外部化したESM内部のimportはmockの対象外。

### 検証コマンドと範囲

- `npm ci --no-audit --no-fund`：クリーンインストール。
- `npm run check`：Node 24.14で型・lint・format・build・55実行テスト・文書検査。
- `volta run --node 22.18.0 node --test test/*.test.js`：55テスト成功。
- `bun test test`：Bun 1.3.5で55テスト成功。
- `node scripts/verify-install.mjs node bun /home/kido/.deno/bin/deno`：新規project二構成で
  型検査と三runtimeの各4ケース（ESM/CJSのmock・復元）成功。利用者のVite 6.4.0を維持。
- `git diff --check`：空白エラーなし。

依存更新中の `npm ci` 失敗は、開発依存のpeer配置が変わったlockfileで再現した。
既存lockfileを起点に通常のnpmで更新し直して解消した。legacy-peer-depsを利用者に要求しない。

未検証: Windows/macOS、Denoでの全55テスト、全Vite pluginとの互換性、native ESMと全ての
循環依存・評価順序の同等性、性能、公開レジストリからの導入。
この確認は承認されたVite統合の実装・検証結果であり、「どのコード・環境でも必ず同じ」の証明ではない。
