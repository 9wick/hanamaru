# CLIと設定ファイル

CLIは、テストファイルの読込・計画の収集・実行・結果表示を行う入口である。
ここに記載するコマンドは設計仕様。ランナー実装はまだない。

```text
hanamaru [files...] [options]
```

## 実行

```console
npx hanamaru
npx hanamaru src/math.test.ts
```

引数なしなら設定のincludeに一致するファイルを読む。
ファイルを指定した場合は、そのファイルを対象とする。

CLIは次の手順を取る。

1. パスを正規化して重複ファイルを除き、パス順でimportする。
2. export名順で完成済みのSuiteを収集し、それぞれ `.plan()` を呼ぶ。
3. 計画を一括して `run()` へ渡す。
4. `RunResult` を整形して表示し、終了コードを返す。

関数等の通常のexportは無視する。設定途中のTestビルダーがexportされていたら読込エラーにする。
同じSuiteを複数のexport名や再exportから収集した場合、重複定義エラーにする。
部品として再利用するものは関数にするか、探索対象外のヘルパーファイルに置く。

## オプション

| オプション | 短縮 | 内容 |
|---|---|---|
| `--filter <text>` | `-t` | ケース名の部分一致 |
| `--reporter <name>` | `-r` | `pretty` / `json` |
| `--config <path>` | `-c` | 設定ファイル |
| `--ci` | | onlyをエラーにする |
| `--no-color` | | 色を無効化する |
| `--help` | `-h` | ヘルプ |
| `--version` | `-v` | バージョン |

filterは正規表現ではない。ケース名に文字列を含むものを残し、その計画を実行する。
`--ci` のonly検査はfilter前の収集結果全体に対して行い、絞り込みでonlyの残存を隠さない。
通常実行のonlyは、filter後に実行器へ渡した計画全体に対して作用する。

## 設定

`hanamaru.config.ts`。

```ts
import { defineConfig } from 'hanamaru'

export default defineConfig({
  include: ['**/*.test.ts'],
  exclude: ['**/node_modules/**', '**/dist/**'],
  reporter: 'pretty',
})
```

CLI引数は設定値を上書きする。明示ファイルはinclude/excludeによる探索を行わず、指定順ではなくパス順に正規化する。
設定ファイルも通常のTypeScriptモジュールとして読む。

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

例えばsendが実際には `{ id: 'u2', name: 'Alice' }` で1回呼ばれたとき、
`calledOnceWith({ id: 'u1', name: 'Alice' })` の失敗は次のように示す。

```text
mock(send).calledOnceWith
  expected: 合計1回、引数 [{ id: 'u1', name: 'Alice' }]
  actual:   合計1回、引数 [{ id: 'u2', name: 'Alice' }]
```

一致しなかった呼び出しを0回と表示しない。
同じケースの複数の失敗はまとめて表示する。
TTYでない出力、または `NO_COLOR` が設定された環境では色を無効にする。

`--reporter json` は [RunResult](./spec/hanamaru.d.ts) を1つのJSON値としてstdoutへ出す。
これは実行結果の形式であり、TestPlanをJSON化したものではない。
診断・テスト中のconsole出力はJSONへ混ぜずstderrへ送る。stdoutへの直接書き込みは利用者が避ける。

## 終了コード

| コード | 意味 |
|---|---|
| 0 | 実行対象に失敗なし。skip/todoだけの場合を含む |
| 1 | ケースの失敗が1件以上 |
| 2 | 引数・設定・読込・定義・計画受付のエラー |

一致ファイルなし、完成済みテストなし、filter後0件はコード2にする。
export漏れや絞り込み間違いを、テスト成功として報告しない。

## ライブラリから実行する

```ts
import { run } from 'hanamaru'
import { users } from './user.test.ts'

const result = await run(users.plan())
```

ライブラリAPIはprocessを終了せず、結果を返す。
計画の受付エラーはPromiseのreject、ケースの失敗は結果の `status: 'failed'` で表す。
