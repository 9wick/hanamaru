# projectの利用例：unitとintegration/e2eを分ける

このページは[project機能](./projects.md)の利用例です。
ここで示すproject名、ファイル配置、収集方法は例の前提であり、hanamaruがunit・integration・e2eの書き方として要求するものではありません。

**実装状況:** projectと[テストの登録](./registration.md)は未実装です。以下の設定・コード・コマンドはAPI案であり、現在のパッケージでは使えません。機能の利用条件・保証は[projectの契約](./projects.md)、現在使える入口は[CLI](./cli.md)を参照してください。

## unitだけを実行し、e2eの環境は起動しない

関数のunit testを確認するときに、別のテストで使うDockerやサーバーを起動せずに済むよう、二つの入口を分ける例です。

この例では、独立して実行できるテストを `src` 配下の `.test.ts` に置き、環境を共有するテストを `e2e/root.ts` に合成しています。
ファイル配置は次のとおりです。

```text
hanamaru.config.ts
src/
  math.ts
  math.test.ts       独立して実行できるルートを登録
e2e/
  root.ts           環境を供給するルートを登録
  users.ts          親のコンテキストを要求する子を定義・export
  orders.ts         親のコンテキストを要求する子を定義・export
  environment.ts    環境を取得・解放するmiddlewareを定義
```

`math.test.ts` を対象のソースの隣に置くのは、この例の配置上の選択です。
`tests/unit` のような別ディレクトリへまとめても構いません。その場合は収集パターンを配置に合わせます。
テスト定義の書き方は[最初のテスト](./getting-started.md#最初のテスト)、CLIへ実行対象を伝える案は[テストの登録](./registration.md)を参照してください。

次の設定では、ファイル探索の入口に `unit`、合成ルートの入口に `e2e` という名前を付けています。
どちらの入口もCLIから実行します。各入口ファイルでルートを `registerTest` に渡し、設定の関数は収集対象のファイルを指定します。テストファイルで `run()` を呼ぶ必要はありません。

<!-- example: none — projectの実装前の利用例。公開APIの型検証・実行例にはまだ含めない -->
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

この構成でunitを選ぶと、`src` 配下の一致したファイルから登録されたルートを収集し、e2eの入口は評価しません。
テストを `src` へ追加すれば探索対象になるため、中央のimport一覧も更新する必要はありません。
unit側はe2eの環境モジュールをimportせず、Dockerの起動は次節のmiddleware内に置いています。この前提によってunitだけを選んだときにDockerは起動しません。

## 環境を複数のテストで共有する

この例の `users` と `orders` は、親が供給するコンテキストを要求します。
そのため、この二つを単独で収集するのではなく、環境を供給するmiddlewareと同じルートへ合成しています。

`e2e/root.ts` の構成例です。
`withDocker` は利用者が [middleware](./middleware.md) で定義する値で、Dockerの起動・停止をその実行内に置きます。

<!-- example: none — registerTestの実装前に、利用者が定義する環境と子を組み合わせる構成例。Dockerを起動する実行例ではない -->
```ts
import { Test, registerTest } from 'hanamaru'
import { withDocker } from './environment.ts'
import { users } from './users.ts'
import { orders } from './orders.ts'

registerTest(
  new Test().group('API', withDocker, [users, orders]),
)
```

```console
npx hanamaru --project e2e
```

`entry('./e2e/root.ts')` は入口ファイルの登録を収集します。子はルートのimportを通じて読み込まれますが、登録していないため単独の実行対象にはなりません。
実行時はgroup全体でDockerを共有し、各ケースのデータの準備・復元は子の `.use()` で各attemptを囲む構成にできます。
環境を共有してもcase間の順序依存は許しません。取得・解放・コンテキスト供給の詳しい書き方は[group全体をmiddlewareで囲む](./grouping.md#group全体をmiddlewareで囲む)を参照してください。

Dockerの利用やgroupによる合成は、e2eと呼ぶテストすべてに必要なものではありません。
各ファイルで単独実行できるルートを登録するなら、e2eの入口にglobを使うこともできます。判断するのはテスト種別ではなく、各入口ファイルで何を登録するかです。

例えば、この例の `users` を単独で `registerTest` に渡そうとすると、親から受け取るctxの要求が残るため型エラーになります。`users.test.ts` をglobで選びながら何も登録しなければ、その入口に登録がない収集エラーになります。
この例では、供給を含む `root.ts` だけをe2eの入口として選びます。停止条件は[登録の契約](./registration.md#収集時の診断)を参照してください。

## 日常の実行コマンドを分ける

前述のproject名に合わせた `package.json` の例です。

```json
{
  "scripts": {
    "test": "tsc --noEmit && hanamaru",
    "test:unit": "tsc --noEmit && hanamaru --project unit",
    "test:e2e": "tsc --noEmit && hanamaru --project e2e"
  }
}
```

`test:unit` はunitだけ、`test:e2e` はe2eだけを選びます。
`test` は設定された両方のprojectを選びます。
unit/e2e以外の分け方もでき、同じ仕組みでintegrationや機能ごとの入口を追加できます。
