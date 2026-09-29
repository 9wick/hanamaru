# CLIと設定ファイル

CLIは、テストファイルの読込・完成したテストの収集・実行・結果表示を行う入口である。
インストールしたパッケージのCLIを、利用するランタイムで起動します。

読むファイルを名前付きで選ぶ[project](./projects.md)と、実行するルートを宣言する[登録](./registration.md)を組み合わせます。unitとintegration/e2eを分ける構成は[利用例](./project-use-cases.md)を参照してください。

## 実行方法の選び方

通常のテスト実行にはCLIを使います。テストファイルは実行するルートを `registerTest` で登録し、CLIが収集・実行・結果表示・終了コードを担当します。

| やりたいこと | 使うもの |
|---|---|
| テストファイルを探索する、ファイルを指定する、ケースを絞って実行する | CLI。ファイル引数・project・`--filter` を使う |
| 読むファイルの集合に名前を付け、必要な集合だけを選ぶ | CLIのproject設定。`hanamaru.config.ts` に各projectの `include` / `exclude` を書き、CLIで選ぶ |
| 自分のプログラムから完成した定義を実行し、結果を処理する | ライブラリAPIの `run(test)` / `run([testA, testB])` |

projectはCLIが読むファイルを選ぶ設定です。複数projectを選んだらファイルをマージし、同じファイルは一度だけ実行します。`--project` と明示ファイルを同時に指定すると引数エラーです。project設定や、CLIが収集するテストファイルの中では `run()` を呼びません。登録の収集後にCLIが実行を管理します。
`run` は渡された完成定義を同一プロセスで実行して `RunResult` を返し、設定ファイルの読込・ファイル探索・project選択・表示・processの終了は行いません。
module namespaceの差し替えや、終了猶予を超えた処理の強制停止が必要な場合はCLIを使います。[モックの範囲](./api-mock.md#差し替えの範囲)と[時間制限](#時間制限)を参照してください。

## コマンド形式

```text
hanamaru [files...] [options]
```

## 実行

```console
npx hanamaru
npx hanamaru src/math.test.ts
```

BunとDenoで実行する場合は、パッケージをインストールしたプロジェクトで次のように起動します。
`bunx` は `--bun` を付け、Bun自身でCLIを実行します。

```console
bunx --bun hanamaru src/math.test.ts
deno run --allow-all --node-modules-dir=manual node_modules/hanamaru/dist/cli.js src/math.test.ts
```

DenoのCLIはファイル読込・環境変数・workerを利用し、実行するテストも資源へアクセスするため、上の例では権限を許可しています。
ライブラリの `run(test)` はDenoでも同じAPIで呼び出せます。

引数なしなら、project設定があれば全projectのファイルを選びます。project設定がなければ `**/*.{test,spec}.ts` を探索し、`node_modules` と `dist` を除外します。明示ファイルを指定した場合はprojectを選ばず、そのファイルを対象とします。`--project` と明示ファイルの同時指定は引数エラーです。

CLIは次の手順を取ります。

1. projectごとに `include` から `exclude` を引き、選んだファイルをマージして重複を除き、パス順でimportします。
2. 各ファイルの `registerTest` で登録された完成定義を収集し、blueprintから実行計画を組み立てます。登録のない選択ファイル、未完成・重複したルートは収集エラーです。exportは収集条件に使いません。
3. filterを適用した実行計画を標準実行器へ渡します。期限を監視し、猶予内に停止しない実行環境は終了させます。
4. `RunResult` を整形して表示し、終了コードを返します。

親のコンテキストを要求する子は、供給する親のgroupに追加してからルートを登録します。`registerTest` の型は親なしで実行できる完成定義だけを受け付けます。CLI自身はTypeScriptの型検査を行いません。型チェックを含むコマンドを用意してください。詳しくは[登録](./registration.md)と[型の限界](./type-inference.md#型の限界)を参照してください。

## オプション

| オプション | 短縮 | 内容 |
|---|---|---|
| `--project <name>` | | 実行するproject。複数回指定可 |
| `--filter <text>` | `-t` | 表示されるケース名の部分一致（eachの行番号・名前を含む） |
| `--reporter <name>` | `-r` | `pretty` / `json` |
| `--config <path>` | `-c` | 設定ファイル |
| `--ci` | | onlyをエラーにする |
| `--fail-on-flaky` | | 再試行後に成功したケースがあれば終了を失敗にする |
| `--collection-timeout <ms>` | | 設定・テストファイルの読込と収集の期限 |
| `--shutdown-grace <ms>` | | run中断後、処理と後始末を待つ猶予 |
| `--no-color` | | 色を無効化する |
| `--help` | `-h` | ヘルプ |
| `--version` | `-v` | バージョン |

filterは正規表現ではない。階層内のケース名に文字列を含むものを残して実行する。
ケースを残すときは祖先のmiddleware・mock・実行設定と階層、元のpathも保持する。ケースが0件になった枝は取り除く。
`--ci` のonly検査はfilter前の収集結果全体に対して行い、絞り込みでonlyの残存を隠さない。
通常実行のonlyは、filter後の実行対象全体に対して作用する。

## 設定

`hanamaru.config.ts`。

<!-- example: docs/examples/hanamaru.config.ts -->
```ts
import { defineConfig } from 'hanamaru'

export default defineConfig({
  projects: {
    default: {
      include: ['**/*.{test,spec}.ts'],
      exclude: ['**/node_modules/**', '**/dist/**'],
    },
  },
  reporter: 'pretty',
  collectionTimeout: 120_000,
  shutdownGrace: 5_000,
})
```
出典: [docs/examples/hanamaru.config.ts](examples/hanamaru.config.ts)

設定がないときの探索パターンは `**/*.{test,spec}.ts` で、`node_modules` と `dist` は除外します。各projectの `include` / `exclude` には既定値を加えません。明示ファイルはprojectの探索を行わず、指定順ではなくパス順に正規化します。
設定ファイルも通常のTypeScriptモジュールとして読む。

### Viteの設定

JS/TSの変換とモジュールの読込はCLIが内部で行います。設定ファイル・事前ビルド・loaderの指定は不要です。
aliasや変換プラグインが必要な場合は、`hanamaru.config.ts` の `vite` にViteの設定を渡します。

<!-- example: docs/examples/hanamaru-vite.config.ts -->
```ts
import { resolve } from 'node:path'
import { defineConfig } from 'hanamaru'

export default defineConfig({
  vite: {
    resolve: {
      alias: { '@app': resolve('src') },
    },
    plugins: [],
  },
})
```
出典: [docs/examples/hanamaru-vite.config.ts](examples/hanamaru-vite.config.ts)

aliasに書いた相対パスは、実行ディレクトリ（`vite.root` の既定値）を基準に解決します。
既存のVite設定を使う場合も、このファイルからimportして `vite` に渡せます。
`vite.config.*` は自動では読みません。関数形式の既存設定は呼び出した結果のオブジェクトを渡します。
テスト探索の `include` / `exclude` はprojectごとのhanamaru側の設定です。
`vite.configFile`、watch、HMR、HTTPサーバーの起動はCLIが管理します。
プラグインは収集側で実行し、同じ変換結果を実行workerへ渡します。
設定やプラグインのエラーは収集エラー（コード2）として報告します。

Viteはhanamaruの依存として同梱されるため、利用者側でのViteの追加インストールは不要です。
独自の変換プラグインが必要な形式では、そのプラグインをプロジェクトに追加して `vite.plugins` へ渡します。
CLIは型チェックを行いません。

## 時間制限

テスト一試行のtimeoutと、CLIの収集期限・終了猶予は別の設定である。
収集や後始末に長い時間が必要なプロジェクトでは、設定ファイルまたはCLI引数で変更できる。

| 設定 | CLI引数 | 既定値 | 範囲 |
|---|---|---|---|
| collectionTimeout | --collection-timeout | 30,000ms | 一ファイルのimport開始から、その登録の収集・blueprint取得まで。依存モジュールの読込やトップレベルのawaitも含む |
| shutdownGrace | --shutdown-grace | 1,000ms | runの中断開始から、進行中の処理・復元・後始末を待つ時間 |

値はミリ秒単位の正の有限値とし、0・負数・非有限値・数値でない指定は設定エラー（コード2）にする。
既定値 → 設定ファイル → CLI引数の順で上書きする。これらはCLIの設定であり、TestBlueprintやCaseResult.config、利用者のコンテキストへ追加しない。

設定ファイル自身の読込にもcollectionTimeoutを適用する。その時点では設定内容が未確定なので、CLI引数があればその値、なければ既定値を使う。
設定ファイル内の値は、その後のテストファイルの読込から適用する。設定ファイル自身のトップレベル処理に時間が必要なら、次のようにCLIで指定する。

```console
npx hanamaru --collection-timeout 120000 --shutdown-grace 5000
```

収集期限を超過した場合は、その読込環境を終了させ、ファイル・段階・適用した期限を示すコード2のエラーにする。
ケースはまだ実行していないのでRunResultや試行を作らない。収集の停止にはshutdownGraceを適用せず、強制終了後のfinallyや資源解放は保証しない。

shutdownGraceは試行timeout・復元や後始末の失敗・Ctrl+Cによるrun中断で使う。timeoutの場合は試行の期限から、それ以外は中断開始から計る。
途中で別の中断原因が加わっても猶予を延長しない。猶予内に終了すれば直ちに結果を返し、未完了なら実行環境を終了させる。
猶予切れ自体では中断理由を変更せず、未完了の後始末をcleanup: incompleteとして表示する。適用した猶予も表示し、強制終了後のfinallyや資源解放は保証しない。
同一プロセスのrun(test)にはこの強制停止を適用しない。

## 型チェックを含む通常の入口

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "tsc --noEmit && hanamaru",
    "test:ci": "tsc --noEmit && hanamaru --ci"
  }
}
```

型チェックはTypeScript、実行はhanamaruが担当する。
`npx hanamaru` 単独では型チェックを行わない。

## 表示

```text
createUser
  ✓ 保存して通知する
  ✓ 保存に失敗したら通知しない
```

例えばsendが実際には `{ id: 'u2' }` で1回呼ばれたとき、
`calledOnceWith({ id: 'u1' })` の失敗は次のように示す。

```text
✗ 保存して通知する  src/user.test.ts:42:4
  call(send).calledOnceWith
    expected: 合計1回、引数 [{ id: 'u1' }]
    actual:   合計1回、引数 [{ id: 'u2' }]
```

表示のsendはexpectCallsで指定したメソッドのキーであり、利用者が付けた別名ではない。
一致しなかった呼び出しを0回と表示しない。
グループは名前があれば見出しとして表示し、無名なら名前を補わず子を表示する。
group(name, [children])で作ったグループの名前を見出しとして使う。名前がなくてもblueprintとJSON結果の階層は保持する。
失敗ケースにはcwdからの相対パスと1始まりの行・列を表示する。
通過したgroupの追加位置も外側から内側へ添え、無名でも省略しない。成功・skip・todoでは位置を並べない。
同じケースの複数の失敗はまとめて表示し、retry後の成功はflakyと各試行を表示する。
[位置と結果](./results.md)、[eachの行表示](./each.md)、[timeout・retryの表示](./execution-options.md)を参照。
TTYでない出力、または `NO_COLOR` が設定された環境では色を無効にする。

`--reporter json` は [RunResult](./spec/hanamaru.d.ts) を1つのJSON値としてstdoutへ出す。
CLI結果の各トップレベルノードには `source: { file, projects }` を含めます。重複して選ばれたファイルは一つの結果に複数のproject名を持ちます。
これは実行結果の形式であり、TestBlueprintをJSON化したものではない。
origin・path・config・各試行と失敗を保持し、任意値はDiagnosticValueの構造で出す。
収集・受付エラーでRunResultがまだなければstdoutへ架空の結果を出さず、ファイル・段階・原因をstderrへ報告する。
診断・テスト中のconsole出力はJSONへ混ぜずstderrへ送る。stdoutへの直接書き込みは利用者が避ける。

## 終了コード

| コード | 意味 |
|---|---|
| 0 | 実行対象に失敗なし。skip/todoだけの場合を含む |
| 1 | ケースまたはgroup middlewareの失敗、timeout、復元・後始末の失敗、またはfail-on-flakyの条件に該当 |
| 2 | 引数・設定・読込・定義・実行受付のエラー（収集のtimeoutを含む） |
| 130 | Ctrl+Cによる中断 |

一致ファイルなし、完成済みテストなし、filter後0件はコード2にする。
登録漏れや絞り込み間違いを、テスト成功として報告しない。
group前処理の通常例外で全子のケースが未実行でも、group middlewareの失敗を報告し、runはfailed / completed、終了コードは1にする。他の中断原因があれば終了理由の優先順位に従う。

Ctrl+Cでは完了済みの結果を保ち、失敗のない実行中の試行をcancelled、未実行の実行対象をnotRun: cancelledにする。既存の失敗や中断後のcleanup失敗は[終了状態の表](./results.md#終了状態の表)に従う。
設定したshutdownGrace内に停止・後始末が終わらなければ実行環境を終了させる。skip/todo等の元の状態は保つ。
Ctrl+Cを受けた終了は、既存の失敗やcleanup失敗によりRunResult.statusがfailedでもコード130にする。読込・収集中のCtrl+Cも130とし、run開始前ならRunResultを作らない。

## ライブラリから実行する

次は、自分のプログラムで結果を処理する場合の例です。CLIで実行するテストファイルに追加するコードではありません。

<!-- example: docs/examples/metadata.ts#run -->
```ts
import { run } from 'hanamaru'
import { users } from './user.test.ts'

const result = await run(users)
```
出典: [docs/examples/metadata.ts](examples/metadata.ts)

ライブラリAPIはprocessを終了せず、処理と後始末を待って結果を返す。
任意コードの強制停止はできず、timeout後も対象が終了しなければ戻らない場合がある。
標準CLIの停止保証との違いは[timeout](./execution-options.md)に記載する。
実行受付エラーはPromiseのreject、ケースの失敗はRunResultの `status: 'failed'` で表す。
