# unitとintegration/e2eを分けて実行する

関数のunit testを確認したいときに、e2e用のDockerやサーバーまで起動する必要はありません。
projectは、実行するテストの収集入口を名前付きで選ぶための単位です。
ソースの近くに置いたテストはファイルから集め、環境を共有するテストはmiddlewareを含むルートを組み立てて選べます。

**実装状況:** projectは未実装です。このページは実装に先立つ利用者との契約を記述します。以下の `projects`・`glob`・`entry`・`--project` はAPI案であり、現在のパッケージでは使えません。現在使える入口は[CLI](./cli.md)と `run(test)` です。

## unitだけを実行する

unit testは対象のソースと同じディレクトリに `math.test.ts` などとして置き、完成した定義をexportします。
テストの追加に合わせて中央のimport一覧を更新する必要がないよう、ファイルの探索で集めます。
テスト自体の書き方は[最初のテスト](./getting-started.md#最初のテスト)と同じです。

`hanamaru.config.ts` に、unitとe2eの入口を分けて指定します。次はAPI案です。

<!-- example: none — projectの実装前に利用方法を示すAPI案。公開APIの型検証・実行例にはまだ含めない -->
```ts
import { defineConfig, glob, entry } from 'hanamaru'

export default defineConfig({
  projects: {
    unit: () => glob('src/**/*.test.ts'),
    e2e: () => entry('./e2e/root.ts'),
  },
})
```

```console
npx hanamaru --project unit
```

この指定ではunitの入口だけを評価し、`src` 配下のテストを収集します。
e2eの入口は評価せず、そこから参照するルート・子・環境用モジュールも読み込みません。
unitのテスト自身がe2eのモジュールをimportすれば、その依存は読み込まれます。入口を分けるときは、unitからe2eの環境起動へ依存させません。

`unit`・`integration`・`e2e` は利用者が付けるproject名です。
hanamaruに組み込まれたテスト種別ではなく、どのprojectでもファイル探索と合成したルートを使えます。
projectを分けても、対象・引数・期待を `new Test()` から書く方法は共通です。

## integration/e2eの環境を組み立てる

親からDBやサーバーを受け取る子は、単独で実行する入口にはしません。
必要なmiddlewareを含むルートに合成し、そのルートだけをprojectの入口にします。

例えば次のようにファイルを分けます。

```text
hanamaru.config.ts
src/
  math.ts
  math.test.ts       unitの探索対象
e2e/
  root.ts           環境を供給する完成したルートをexport
  users.ts          親のコンテキストを要求する子をexport
  orders.ts         親のコンテキストを要求する子をexport
  environment.ts    環境を取得・解放するmiddlewareを定義
```

`e2e/root.ts` の構成例です。`withDocker` は利用者が [middleware](./middleware.md) で定義する値で、Dockerの起動・停止をその実行の内側に置きます。hanamaruが提供するDocker専用APIではありません。

<!-- example: none — 利用者が定義する環境と子を組み合わせる構成例。Dockerを起動する実行例ではない -->
```ts
import { Test } from 'hanamaru'
import { withDocker } from './environment.ts'
import { users } from './users.ts'
import { orders } from './orders.ts'

export const e2e = new Test()
  .group('API', withDocker, [users, orders])
```

```console
npx hanamaru --project e2e
```

このprojectは `root.ts` から完成したルートを収集します。
子はルートのimportを通じて読み込まれ、単独の実行対象としては収集しません。
ルートには親のコンテキストを要求しない完成値だけをexportします。
子が要求するコンテキストは、ルート内のgroup合成時に型検査します。CLIの収集時に型引数を検査する保証はありません。通常の実行入口には[型チェック](./cli.md#型チェックを含む通常の入口)も含めます。

Dockerやサーバーをgroup全体で共有し、各ケースに必要なデータの準備・復元は子の `.use()` で各attemptを囲みます。
環境の共有はcase間の順序依存を許しません。
取得・解放・コンテキスト供給の詳しい書き方は[group全体をmiddlewareで囲む](./grouping.md#group全体をmiddlewareで囲む)を参照してください。

ルートだけを対象にしたファイル探索も使えます。e2eでglob自体を禁止するのではなく、親を必要とする子まで独立したルートとして拾わないことが重要です。

## projectとgroupの役割

| 操作 | 利用者が決めること |
|---|---|
| project | 実行するテストの収集入口と、その名前 |
| group | 子の合成、共通設定とmiddlewareの適用範囲 |
| run | 完成した定義の実行 |

project名は、テストのgroup名や対象ケース群の名前を変更しません。
projectはコンテキストの供給元でもありません。必要な値は既存のmiddlewareで供給します。
projectの入口を返す関数の中では `run()` を呼ばず、実行対象を返します。収集・filter・実行・結果表示・終了コードはCLIが管理します。

## 入口を選ぶときの契約

以下をproject機能の利用者向けの保証とします。実装・検証は今後この契約に合わせて行います。

### 選択と収集

- `--project <name>` は名前の完全一致でprojectを選びます。複数指定すると、その集合を選びます。同じ名前を繰り返しても二重に実行しません。
- projectを設定して名前を指定しない場合は、設定された全projectを選びます。設定とは別の既定globを追加して収集しません。
- 全件実行は全projectを選ぶ操作です。unitとe2eを再収集する `all` projectを別途定義する必要はありません。
- 未知のproject名は設定・引数エラーとして終了コード2にします。既定探索へ切り替えません。
- 選択したprojectの入口だけを評価・収集します。ファイル名からunit/e2eを推測したり、親groupを自動で補ったりしません。
- projectの入口は、親なしで実行できる完成した定義を収集するものにします。未完成のビルダーや、完成定義のない入口は収集エラーです。
- 一つのproject内で同じ定義を複数のルートとして収集した場合は、現行CLIと同じく重複定義エラーです。同じ子をgroup内の複数箇所へ合成することは引き続き許可します。

### 環境を起動する時点

- `glob`・`entry` は収集対象の指定です。指定を作るだけではファイルをimportせず、middlewareも実行しません。
- 設定とprojectの入口は定義を組み立てるためのコードです。Docker・DB・サーバーの取得はmiddlewareの実行内に置き、設定やimportのトップレベルでは起動しません。
- 収集と実行計画の作成を終え、filterを適用してから、実行する枝のmiddlewareを開始します。
- filterで残したケースには、その祖先のmiddleware・mock・実行設定を保持します。実行対象を持たない枝のmiddlewareは起動しません。
- 全体でfilterに一致するケースがなければ終了コード2にし、middlewareは起動しません。skip・todo・onlyによる実行対象の扱いも[既存の実行セマンティクス](./semantics.md)に従います。
- 設定・入口・テストモジュールに利用者が書いた任意の副作用を、hanamaruが自動で抑止する保証はありません。unitだけでDockerを起動しない構成は、入口の分離とmiddleware内での資源取得によって作ります。

### 結果と終了

- 結果を読むときに所属projectを識別でき、同じケース名を持つ別projectを区別できることを保証します。
- 複数projectを選んでも、どれかの失敗を成功として報告しません。終了コードは[CLIの規則](./cli.md#終了コード)に従います。
- projectの選択によって、caseの独立性、retry・timeout、middlewareの後始末、CLIの停止保証を弱めません。

## 設定なしで始める

projectを使うために、最初のテストから設定ファイルを用意する必要はありません。
`projects` を設定していない場合は、現在のCLIのファイル指定と `include` / `exclude` を維持します。
設定もファイル指定もなければ、`**/*.{test,spec}.ts` を探索し、`node_modules` と `dist` を除外します。

この既定探索はunit/e2eを区別しません。
テストが増えて環境の起動を分けたくなったら、名前付きprojectを設定し、unit用の実行コマンドを用意します。次はproject対応後の設定例です。

```json
{
  "scripts": {
    "test": "tsc --noEmit && hanamaru",
    "test:unit": "tsc --noEmit && hanamaru --project unit",
    "test:e2e": "tsc --noEmit && hanamaru --project e2e"
  }
}
```

## 実装前に残るAPIの詳細

名称はproject、設定ファイルは `hanamaru.config.ts` とします。
このページの利用場面と保証を先に契約とし、次の詳細は実装に着手する前にAPI・型仕様へ反映します。

- `projects` の値の型、入口を返す関数の引数と戻り値、完成した定義を直接返す形。
- `glob` / `entry` の公開シグネチャ、複数の収集元を組み合わせる形、相対パスの基準。
- `projects` と既存のトップレベル `include` / `exclude` の併用規則、および明示ファイル指定とproject選択の組み合わせ。
- projectごとの設定項目と上書き規則、複数projectの結果・JSON形式、実行順と中断時の扱い。

`run(glob(...))`、project単位のglobalSetup、registerやin-sourceの収集口は、この契約に含めません。
既存のライブラリAPI `run(test)` と `run([testA, testB])` は完成した定義を受け取る入口として維持します。
