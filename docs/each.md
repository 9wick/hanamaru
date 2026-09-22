# データを並べてケースを定義する

`each(name, rows, body)` はitと並ぶ入口です。一行ごとに独立したケースを作ります。

```ts
import { Test } from 'hanamaru'
import { add } from './math.ts'

export const addition = new Test()
  .target(add)
  .each('2つの数を足す', [
    { a: 1, b: 2, expected: 3 },
    { a: 2, b: 3, expected: 5 },
  ], (t, row) => t
    .args(row.a, row.b)
    .expect(e => [e.result.toBe(row.expected)]))
```

rowは行データから、argsとresultはtargetから型推論します。
行はオブジェクトでもタプルでも渡せます。IDや行名の追加登録は不要です。
tはitと同じビルダーで、mock・timeout・retry・args / argsFrom・expect / expectCallsを使えます。
各行で、引数と一つ以上の期待を設定した完成済みのケースを返します。

名前に関数を渡すこともできます。

```ts
new Test().target(add).each(
  row => `${row.a} + ${row.b}`,
  [{ a: 1, b: 2, expected: 3 }],
  (t, row) => t.args(row.a, row.b).expect(e => [e.result.toBe(row.expected)]),
)
```

固定名には1始まりの行番号を付けて `2つの数を足す [1]` と表示します。
名前の関数を使った場合はその戻り値を表示し、一意性は要求しません。
どちらでも失敗詳細には元の行と1始まりの行番号を表示します。

```text
add
  ✓ 2つの数を足す [1]
  ✗ 2つの数を足す [2]  src/math.test.ts:6:4
    row 2: { a: 2, b: 3, expected: 5 }
    result.toBe
      expected: 5
      actual:   4
```

定義時に行順で展開し、名前の関数と本体を各行1回評価します。retryではこの定義を作り直しません。
全行が通常のCaseとして計画へ入り、row.index（0始まり）とrow.valueに元の行を持ちます。
originはeachの宣言位置で、行番号とは別です。結果ではrow.valueを診断用の値に変換します。

setup/use・モックの状態・呼び出し記録は各行・各試行で作り直します。
静的に共有した行のオブジェクト内部まで複製しません。独立した値が必要ならsetup/use/argsFromで生成します。
空の行配列は定義エラー、名前や本体のthrowも定義エラーです。

呼び出し後はSuiteへ戻り、別のitやeachを追加できます。最初のeach以降は共通設定も固定します。
非同期の行取得、each専用のonly/skip/todo表記は初版には含めません。
全体のonlyとCLIのfilterは、展開された通常のケースとしてeachにも適用します。
