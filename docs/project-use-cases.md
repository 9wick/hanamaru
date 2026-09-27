# projectの利用例：unitとintegration/e2eを分ける

このページは[projectのファイル選択](./projects.md)と[テストの登録](./registration.md)を組み合わせる例です。unit・e2eという名前や配置は、この例の選択であり、hanamaruのテスト種別ではありません。

**実装状況:** projectと[テストの登録](./registration.md)は未実装です。以下の設定・コード・コマンドはAPI案であり、現在のパッケージでは使えません。機能の利用条件・保証は[projectの契約](./projects.md)、現在使える入口は[CLI](./cli.md)を参照してください。

## unitだけを実行し、e2eの環境は起動しない

関数のunit testだけを確認するときに、e2eのDockerを起動しない構成を考えます。この例ではunitのテストファイルを `src` 配下に置き、e2eで実行するルートを `e2e/root.ts` に登録します。

`hanamaru.config.ts` で、それぞれ読むファイルを指定します。どちらも文字列による同じ指定方法です。`unit` と `e2e` はCLIで選ぶために付けた名前です。

<!-- example: none — projectの実装前の利用例。公開APIの型検証・実行例にはまだ含めない -->
```ts
import { defineConfig } from 'hanamaru'

export default defineConfig({
  projects: {
    unit: 'src/**/*.test.ts',
    e2e: 'e2e/root.ts',
  },
})
```

```console
npx hanamaru --project unit
```

unitを選ぶと、`src/**/*.test.ts` に一致するファイルだけを収集対象として読みます。`e2e/root.ts` は収集対象になりません。unitのテストファイルを増やしても、設定のimport一覧を編集する必要はありません。

各ファイルでは、CLIに実行させたいルートを `registerTest(...)` で登録します。登録した定義のexportは不要です。[登録の例](./registration.md#cliに実行するルートを伝える)を参照してください。`src` 側からe2eのファイルをimportせず、Dockerの取得を次節のmiddleware内に置けば、unitだけを選んだ実行でDockerは起動しません。

## 環境を複数のテストで共有する

e2eでは複数のケースが同じ環境を使うことがあります。この例の `users` と `orders` は、親が供給するコンテキストを要求する完成定義です。環境を供給するmiddlewareと一緒にgroupへ合成し、そのルートを登録します。

`e2e/root.ts` の構成例です。
`withDocker` は利用者が[middleware](./middleware.md)で定義する値で、Dockerの起動・停止をその実行内に置きます。

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

`e2e` projectは `e2e/root.ts` を読み、そのファイルの登録を収集します。この例では `users` と `orders` を別ファイルからimportしています。子のexportはこのimportに使うだけで、CLIへの登録にはなりません。子もルートも同じファイルに書けます。
実行時はgroup全体でDockerを共有し、各ケースのデータの準備・復元は子の `.use()` で各attemptを囲む構成にできます。
環境を共有してもcase間の順序依存は許しません。取得・解放・コンテキスト供給の詳しい書き方は[group全体をmiddlewareで囲む](./grouping.md#group全体をmiddlewareで囲む)を参照してください。

Dockerやgroupはe2eという名前に必須ではありません。各ファイルに単独実行できるルートがあるなら、`e2e: 'e2e/**/*.test.ts'` のように複数ファイルを選べます。逆に、この例の `users` を親の供給なしで登録すると型エラーになります。親を必要とする子はgroupへ渡し、供給を含むルートを登録します。詳しくは[登録の契約](./registration.md)を参照してください。

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
