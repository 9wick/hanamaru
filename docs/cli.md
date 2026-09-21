# CLI と設定ファイル

hanamaru は自前のランナー CLI を持ちます。実行時依存パッケージは 0 です。

```text
hanamaru [files...] [options]
```

関連: [実行セマンティクス](./semantics.md) / [はじめに](./getting-started.md)

## 基本の使い方

インストールせずに実行できます。

```console
$ npx hanamaru
```

Bun を使っている場合はこちらです。

```console
$ bunx hanamaru
```

### 引数なしで実行したとき

対象ファイルを設定ファイルの `include` から決めます。設定ファイルがない場合、あるいは
`include` を書いていない場合の既定値は `**/*.test.ts` です。

```console
$ npx hanamaru
```

集めたファイルを `import()` し、export されている `Test` インスタンスを実行します。
どのテストが実行対象になるかの詳細は [実行セマンティクス](./semantics.md) を参照してください。

### ファイルを指定したとき

ファイルを引数に渡すと、設定ファイルの `include` ではなく、指定したファイルだけを実行します。

```console
$ npx hanamaru src/user.test.ts
```

## オプション一覧

| オプション | 短縮 | 意味 |
|---|---|---|
| `--filter <pattern>` | `-t` | テスト名で絞り込み |
| `--reporter <name>` | `-r` | `pretty`（既定） / `json` |
| `--config <path>` | `-c` | 設定ファイルのパス |
| `--no-color` | | 色を無効化 |
| `--help` | `-h` | ヘルプ |
| `--version` | `-v` | バージョン |

### `--filter` / `-t`

テスト名で実行するケースを絞り込みます。

[実行セマンティクス](./semantics.md) で使っているテスト定義には
「保存して通知する」「保存に失敗したら通知しない」の 2 ケースがあります。
「保存」で絞り込むと、どちらも名前に「保存」を含むため両方が実行対象になります。

```console
$ npx hanamaru -t '保存'
```

ファイル指定と組み合わせられます。

```console
$ npx hanamaru src/user.test.ts -t '保存に失敗'
```

### `--reporter` / `-r`

出力形式を選びます。既定は `pretty` です。

```console
$ npx hanamaru -r pretty
$ npx hanamaru -r json
```

`pretty` は人間が読むための形式です。成功したときの出力はこうなります。

```console
$ npx hanamaru src/user.test.ts

createUser
  ✓ 保存して通知する
  ✓ 保存に失敗したら通知しない
```

失敗したときは、失敗したアサーションをまとめて表示します。

```console
✗ 保存して通知する

  2 件のアサーションが失敗しました

  [1] result.toEqual
      - expected: { id: 'u1' }
      + actual:   { id: 'u2' }

  [2] mock(mailService.send).calledOnceWith
      expected: 1 回 { id: 'u1' } で呼ばれること
      actual:   0 回
```

1つのアサーションが落ちても後続は評価されるため、失敗は一度にすべて出ます。
この挙動については [アサーションは全部評価する](./semantics.md#アサーションは全部評価する) を参照してください。

`json` は結果を JSON 形式で出力します。CI での機械処理を想定した形式です。

### `--config` / `-c`

設定ファイルのパスを指定します。

```console
$ npx hanamaru --config ./config/hanamaru.config.ts
```

### `--no-color`

出力の色付けを無効にします。

```console
$ npx hanamaru --no-color
```

このオプションを付けなくても、次の場合は色付けが**自動的に無効になります**。

- 出力先が TTY でないとき（パイプやファイルへのリダイレクト、多くの CI 環境）
- `NO_COLOR` 環境変数があるとき

明示的に `--no-color` を付ける必要があるのは、TTY に出力しているが色を出したくない場合だけです。

### `--help` / `-h`

使い方を表示します。

```console
$ npx hanamaru --help
```

### `--version` / `-v`

バージョンを表示します。

```console
$ npx hanamaru --version
```

## 設定ファイル

設定は `hanamaru.config.ts` に書きます。**設定ファイルも TypeScript で書けます。**
hanamaru は `.ts` をそのまま実行できるため、設定のためにビルド手順を足す必要はありません。

```ts
import { defineConfig } from 'hanamaru'

export default defineConfig({
  include: ['**/*.test.ts'],
  exclude: ['**/node_modules/**', '**/dist/**'],
  reporter: 'pretty',
})
```

`defineConfig` は hanamaru が export するヘルパーです。設定オブジェクトに型が付くため、
キーの typo や値の型違いがエディタ上で分かります。

### 設定項目

| 項目 | 既定値 | 意味 |
|---|---|---|
| `include` | `['**/*.test.ts']` | テストファイルを集める glob パターン |
| `exclude` | `['**/node_modules/**', '**/dist/**']` | 除外する glob パターン |
| `reporter` | `'pretty'` | 出力形式（`'pretty'` / `'json'`） |

`exclude` の既定に `**/node_modules/**` が入っているのは、単に不要だからではありません。
Node は `node_modules` 配下の `.ts` の実行を拒否するため、そこを集めてしまうと必ず失敗します。
`exclude` を上書きするときも `**/node_modules/**` は残してください。

### コマンドライン引数と設定ファイルの優先順位

**コマンドライン引数が設定ファイルより優先されます。** 例外はありません。

- ファイルを引数で指定すると、`include` は使われません
- `--reporter` を指定すると、設定ファイルの `reporter` は使われません

設定ファイルはプロジェクトの既定値を決めるもので、コマンドライン引数はその場限りの上書きである、
という関係です。

## 実行例

```console
$ npx hanamaru
```
設定ファイルの `include`（既定 `**/*.test.ts`）に一致するすべてのテストを実行します。

```console
$ npx hanamaru src/user.test.ts
```
`src/user.test.ts` だけを実行します。

```console
$ npx hanamaru -t '保存' -r json
```
名前に「保存」を含むケースだけを実行し、結果を JSON 形式で出力します。

```console
$ bunx hanamaru --config ./config/hanamaru.config.ts
```
Bun で、既定の場所ではない設定ファイルを指定して実行します。

## package.json への組み込み

`scripts` に足しておくと、`npm test` で実行できます。

```json
{
  "scripts": {
    "test": "hanamaru"
  }
}
```

hanamaru は型チェックを行いません。テストを実行するだけです。
型エラーは `tsc --noEmit` で別途検出してください。

```json
{
  "scripts": {
    "test": "hanamaru",
    "typecheck": "tsc --noEmit"
  }
}
```

## CI での使い方

CI では終了コードで成否を判定します。

| コード | 意味 |
|---|---|
| 0 | 全て成功（skip / todo のみでも 0） |
| 1 | テストが1つ以上失敗 |
| 2 | 設定エラー・ファイル読み込みエラー |

テストの失敗（1）と、設定エラー・ファイル読み込みエラー（2）が区別されるため、
「テストが落ちた」のか「そもそも実行できなかった」のかを終了コードだけで切り分けられます。
詳しくは [終了コード](./semantics.md#終了コード) を参照してください。

結果を機械的に処理したい場合は `--reporter json` を使います。

```console
$ npx hanamaru --reporter json > result.json
```

CI 環境では出力先が TTY でないことが多いため、色付けは自動的に無効になります。
`--no-color` を明示する必要は通常ありません。
