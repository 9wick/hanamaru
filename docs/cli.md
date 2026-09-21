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
2. export名順で完成済みのテストまたはグループをルートとして収集し、それぞれ `.plan()` を呼ぶ。filter前の計画内のpathを確定する。
3. 計画を一括して標準実行器へ渡す。期限を監視し、猶予内に停止しない実行環境は終了させる。
4. `RunResult` を整形して表示し、終了コードを返す。

関数等の通常のexportは無視する。設定途中のTestビルダーがexportされていたら読込エラーにする。
同じ定義を複数のexport名や再exportからルートとして収集した場合、重複定義エラーにする。
groupの内部で同じ子を複数箇所に合成することは許可し、それぞれを独立した実行箇所として扱う。
子をルートとしてもexportすると、合成先とは別に収集される。子の定義は探索対象外のファイルに置き、実行するルートだけをテストファイルからexportする。

親ctxを要求する子は単独では実行しない。例えば `user-cases.ts` の子を、ctxを用意した親へ追加し、その親をテストファイルからexportする。
CLIは型引数を実行時に検査できないため、このexportの条件は利用者が守る。
`group` とライブラリの `run` ではctxの供給を型検査する。[型の限界](./type-inference.md#型の限界)を参照。

## オプション

| オプション | 短縮 | 内容 |
|---|---|---|
| `--filter <text>` | `-t` | 表示されるケース名の部分一致（eachの行番号・名前を含む） |
| `--reporter <name>` | `-r` | `pretty` / `json` |
| `--config <path>` | `-c` | 設定ファイル |
| `--ci` | | onlyをエラーにする |
| `--fail-on-flaky` | | 再試行後に成功したケースがあれば終了を失敗にする |
| `--no-color` | | 色を無効化する |
| `--help` | `-h` | ヘルプ |
| `--version` | `-v` | バージョン |

filterは正規表現ではない。階層内のケース名に文字列を含むものを残し、その計画を実行する。
ケースを残すときは祖先のsetup・use・mock・実行設定と階層、元のpathも保持する。ケースが0件になった枝は取り除く。
`--ci` のonly検査はfilter前の収集結果全体に対して行い、絞り込みでonlyの残存を隠さない。
通常実行のonlyは、filter後に実行器へ渡した計画全体に対して作用する。

ファイルの読込と定義収集には、一ファイルにつき30,000msの期限を適用する。設定ファイルの読込にも同じ期限を適用する。
超過時はファイルと収集段階を示すコード2のエラーとし、架空のケース結果は作らない。

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
group(name, child)の名前はその場所の見出しとして使う。名前がなくても計画とJSON結果の階層は保持する。
失敗ケースにはcwdからの相対パスと1始まりの行・列を表示する。
通過したgroupの追加位置も外側から内側へ添え、無名でも省略しない。成功・skip・todoでは位置を並べない。
同じケースの複数の失敗はまとめて表示し、retry後の成功はflakyと各試行を表示する。
[位置と結果](./results.md)、[eachの行表示](./each.md)、[timeout・retryの表示](./execution-options.md)を参照。
TTYでない出力、または `NO_COLOR` が設定された環境では色を無効にする。

`--reporter json` は [RunResult](./spec/hanamaru.d.ts) を1つのJSON値としてstdoutへ出す。
これは実行結果の形式であり、TestPlanをJSON化したものではない。
origin・path・config・各試行と失敗を保持し、任意値はDiagnosticValueの構造で出す。
収集・受付エラーでRunResultがまだなければstdoutへ架空の結果を出さず、ファイル・段階・原因をstderrへ報告する。
診断・テスト中のconsole出力はJSONへ混ぜずstderrへ送る。stdoutへの直接書き込みは利用者が避ける。

## 終了コード

| コード | 意味 |
|---|---|
| 0 | 実行対象に失敗なし。skip/todoだけの場合を含む |
| 1 | ケースの失敗、timeout、復元・後始末の失敗、またはfail-on-flakyの条件に該当 |
| 2 | 引数・設定・読込・定義・計画受付のエラー（収集のtimeoutを含む） |
| 130 | Ctrl+Cによる中断 |

一致ファイルなし、完成済みテストなし、filter後0件はコード2にする。
export漏れや絞り込み間違いを、テスト成功として報告しない。

Ctrl+Cでは完了済みの結果を保ち、実行中と未実行の実行対象をcancelledにする。
1,000msの猶予内に停止・後始末が終わらなければ実行環境を終了させる。skip/todo等の元の状態は保つ。

## ライブラリから実行する

```ts
import { run } from 'hanamaru'
import { users } from './user.test.ts'

const result = await run(users.plan())
```

ライブラリAPIはprocessを終了せず、処理と後始末を待って結果を返す。
任意コードの強制停止はできず、timeout後も対象が終了しなければ戻らない場合がある。
標準CLIの停止保証との違いは[timeout](./execution-options.md)に記載する。
計画の受付エラーはPromiseのreject、ケースの失敗は結果の `status: 'failed'` で表す。
