# projectの利用例：unitとintegration/e2eを分ける

このページは[project機能](./projects.md)の利用例です。
ここで示すproject名、ファイル配置、収集方法は例の前提であり、hanamaruがunit・integration・e2eの書き方として要求するものではありません。

**実装状況:** projectは未実装です。以下の設定・コマンドはAPI案であり、現在のパッケージでは使えません。機能の利用条件・保証は[projectの契約](./projects.md)、現在使える入口は[CLI](./cli.md)を参照してください。

## unitだけを実行し、e2eの環境は起動しない

関数のunit testを確認するときに、別のテストで使うDockerやサーバーを起動せずに済むよう、二つの入口を分ける例です。

この例では、独立して実行できるテストを `src` 配下の `.test.ts` に置き、環境を共有するテストを `e2e/root.ts` に合成しています。
ファイル配置は次のとおりです。

```text
hanamaru.config.ts
src/
  math.ts
  math.test.ts       独立して実行できる完成定義をexport
e2e/
  root.ts           環境を供給する完成したルートをexport
  users.ts          親のコンテキストを要求する子をexport
  orders.ts         親のコンテキストを要求する子をexport
  environment.ts    環境を取得・解放するmiddlewareを定義
```

`math.test.ts` を対象のソースの隣に置くのは、この例の配置上の選択です。
`tests/unit` のような別ディレクトリへまとめても構いません。その場合は収集パターンを配置に合わせます。
テスト定義の書き方は[最初のテスト](./getting-started.md#最初のテスト)を参照してください。

次の設定では、ファイル探索の入口に `unit`、合成ルートの入口に `e2e` という名前を付けています。

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

この構成でunitを選ぶと、`src` 配下の定義を収集し、e2eの入口は評価しません。
テストを `src` へ追加すれば探索対象になるため、中央のimport一覧も更新する必要はありません。
unit側はe2eの環境モジュールをimportせず、Dockerの起動は次節のmiddleware内に置いています。この前提によってunitだけを選んだときにDockerは起動しません。

## 環境を複数のテストで共有する

この例の `users` と `orders` は、親が供給するコンテキストを要求します。
そのため、この二つを単独で収集するのではなく、環境を供給するmiddlewareと同じルートへ合成しています。

`e2e/root.ts` の構成例です。
`withDocker` は利用者が [middleware](./middleware.md) で定義する値で、Dockerの起動・停止をその実行内に置きます。

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

`entry('./e2e/root.ts')` は完成したルートを収集します。
子はルートのimportを通じて読み込まれ、単独の実行対象としては収集しません。
実行時はgroup全体でDockerを共有し、各ケースのデータの準備・復元は子の `.use()` で各attemptを囲む構成にできます。
環境を共有してもcase間の順序依存は許しません。取得・解放・コンテキスト供給の詳しい書き方は[group全体をmiddlewareで囲む](./grouping.md#group全体をmiddlewareで囲む)を参照してください。

Dockerの利用やgroupによる合成は、e2eと呼ぶテストすべてに必要なものではありません。
各ファイルの定義が単独で実行できるなら、e2eの入口にglobを使うこともできます。
ルートだけをglobで収集する構成も可能です。判断するのはテスト種別ではなく、収集する定義が親なしで実行できるかどうかです。

例えば、この例の `users` を `users.test.ts` からもexportし、そのファイルまでglobで収集すると、親から受け取るctxの要求が残ります。
projectの契約では、この収集入口を設定エラーとして停止します。`users` を除外して成功扱いにすることはありません。
エラーを直すには、供給を含む `root.ts` を収集し、子を別のルートとして拾わないよう収集対象を変更します。停止条件の詳細は[globで未供給のctx要求を見つけたとき](./projects.md#globで未供給のctx要求を見つけたとき)を参照してください。

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
