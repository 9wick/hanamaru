# 実行計画とmetadata

**metadataは、テストがどういうものかを構造化した実行計画 `TestPlan` である。**
計画を作る処理と、計画を実行する処理を分離する。
この契約は計画の利用目的を規定しない。

```ts
import { run } from 'hanamaru'
import { users } from './user.test.ts'

const plan = users.plan() // 計画を取得する
const result = await run(plan) // 計画を実行する
```

計画の構造だけを必要とするコードは `run()` を呼ぶ必要がない。
実行器も公開された計画を入力にし、ビルダーの非公開状態から追加の実行情報を引き出さない。

## 計画の全体

公開型の正本は [hanamaru.d.ts](./spec/hanamaru.d.ts)。概形は次のとおり。

```ts
interface TestPlan<F, C> {
  version: 1
  name: string
  target: TargetPlan<F, C>
  setup: SetupPlan<C> | null
  cases: readonly CasePlan<F, C>[]
}
```

上記は説明用の概形。実際の型ではFの制約、readonly、生成済み計画を表すブランドを持ち、
`CasePlan` に相当する部分は `ExecutableCase | TodoCase` というunionである。
ブランドは計画の出自を型で区別するもので、関数を外部レジストリから引くためのIDではない。

| 要素 | 保持するもの |
|---|---|
| `version` | 計画構造のバージョン |
| `name` | テスト全体の名前 |
| `target` | 呼び出す対象とその取得方法 |
| `setup` | ケースの準備と後始末。省略時はnull |
| `cases` | 宣言順のケース。入力・実効モック・期待を含む |

`.plan()` の前後でtarget・setup・モック・遅延値を実行しない。
`.plan()` はビルダーの定義済み情報を公開構造へ変換する。
同じ定義から得た計画は同じ意味を持ち、取得回数によってケースやコールバックが増えない。

## 対象

`target.kind` は3種類。

| kind | フィールド | 意味 |
|---|---|---|
| `function` | `fn` | 関数を呼ぶ |
| `method` | `object`, `key`, `fn` | 保持したメソッドを、そのobjectをthisにして呼ぶ |
| `factory` | `get` | setup後にctxを渡して対象関数を得る |

任意の `name` と `source` も保持する。`source` は宣言元について利用者が付ける注釈であり、
実行時の関数・オブジェクト参照と別に扱う。注釈から関数をロードし直すことはない。

対象は単一の関数でも、複数の操作を包んだ関数でもよい。
後者の関数本体を展開して内部の呼び出し一覧を生成することはしない。

## 準備と後始末

```ts
setup: {
  create: () => fixture,
  dispose: fixture => fixture.close(),
}
```

これは関数への参照を含む構造の例。
createはケースごとに評価し、Promiseなら解決した値をctxとする。
disposeは同じctxを受け取る。後始末が不要なら省略する。

ctxの実体や生成したDB接続等は、実行前の計画には存在しない。
計画に入るのは、それを得る方法である。

## ケース

実行本体があるケースは次を持つ。

```ts
{
  id: 'save-and-notify',
  name: '保存して通知する',
  mode: 'run', // 'only' / 'skip' も同じ構造
  mocks: [/* 名前・登録先・振る舞い */],
  args: { kind: 'value', value: [{ name: 'Alice' }] },
  outcome: { kind: 'return', assertions: [/* 条件 */] },
}
```

IDは1つのTestPlan内で一意。明示しなければケース名を使う。
異なる計画間でIDが同じでもよく、計画をまたぐ同一性を暗黙に主張しない。
任意の `source: { file, line, column }` はケース宣言位置の注釈。

`todo` は `id`, `name`, `mode: 'todo'`, 任意のsourceだけを持つ。
存在しない本体を空の正常終了ケースへ変換しない。
`skip` は実行しないという指定と、定義済みの本体の両方を保持する。

## 値と、値を得る方法

```ts
type ValuePlan<V, C> =
  | { kind: 'value'; value: V }
  | { kind: 'from-context'; label: string; get: (ctx: C) => V }
```

`.args(1, 2)` は `{ kind: 'value', value: [1, 2] }` になる。
`.argsFrom('fixtureの入力', ctx => [ctx.input])` は `from-context` と関数を保持する。
実行前に結果を推測した値で埋めない。

期待値の `toEqualFrom` や、振る舞いの `resolvesFrom` も同じ表現を使う。
同じ表現でも評価時点は置かれた場所に従う。[実行タイミング](#評価タイミング)を参照。

labelは遅延した定義を説明する文字列で、関数を置き換えるものではない。

## モック

```ts
{
  name: 'save',
  binding: { kind: 'method', object: userRepository, key: 'save' },
  behavior: {
    kind: 'resolves',
    value: { kind: 'value', value: { id: 'u1', name: 'Alice' } },
  },
}
```

モックは登録名に加えて、対象と振る舞いをそのまま保持する。
名前だけ、文字列化したオブジェクト名だけに置き換えない。
`mockFrom` の登録先は `{ kind: 'from-context', getObject, key }` になる。

| behavior.kind | 内容 |
|---|---|
| `returns` / `resolves` | `value: ValuePlan` |
| `throws` / `rejects` | throw / rejectする `error` |
| `callsFake` | 説明の `label` と `fn: ValuePlan` |

各ケースの `mocks` は共通登録・ケース追加・overrideを解決済みの一覧。
同じ登録名は1回だけ現れ、実行器が適用するものと一致する。
共通登録順を保ち、overrideはその位置で振る舞いを置き換え、ケース内の追加は末尾へ並ぶ。

参照が同じオブジェクトは計画の中でも同じ参照として保持する。
文脈から生成するオブジェクトの実体はまだないため、計画にはselectorを保持する。

## 終了の期待とアサーション

```ts
outcome: {
  kind: 'return',
  assertions: [
    {
      subject: 'result',
      check: {
        matcher: 'toEqual',
        expected: { kind: 'value', value: { id: 'u1', name: 'Alice' } },
      },
    },
    {
      subject: 'mock',
      name: 'send',
      check: { matcher: 'calledTimes', count: 1 },
    },
  ],
}
```

`outcome.kind` は `return` または `throw`。追加アサーションがなくても必ず存在する。
`return` にはresultとmockの検証、`throw` にはerrorとmockの検証だけが入る。
`expect()` / `expectError()` を引数なしで呼んだ場合、assertionsは空である。

各アサーションはsubjectとcheckを持つ。checkはmatcherごとのdiscriminated union。
比較値、コンストラクタ、正規表現、述語の参照も保持する。
`toSatisfy` はlabelとpredicateを持ち、結果とctxを受け取る関数として保存する。

引数の型やモックの名前はビルダーで検証する。
公開計画では異なるモック関数の型を一つの配列へ格納するため、一部の値の型を `unknown` へまとめる。
型がまとめられても、値や実行に必要な参照は失わない。

## 評価タイミング

| 処理 | 定義時 | plan取得時 | ケース実行時 |
|---|---|---|---|
| it / expect / mockの記述コールバック | 1回評価 | 再評価しない | 再評価しない |
| setup.create | 保持 | 保持 | 最初に評価・await |
| targetFrom / mockFrom / 振る舞いの*From | 保持 | 保持 | setup後に評価 |
| argsFrom | 保持 | 保持 | モック適用後、target前に評価 |
| target | 保持 | 保持 | 引数確定後に呼ぶ |
| 期待値の*From / toSatisfy | 保持 | 保持 | target終了後に評価 |
| setup.dispose | 保持 | 保持 | finallyで評価・await |

## イミュータビリティと参照

計画の構造はreadonlyで、実装では計画自身が作るコンテナを凍結する。
ユーザーが渡したオブジェクト、関数、期待値の内部まで凍結・複製しない。
`toBe` の参照同一性や、モック対象の同一性を維持するためである。

定義後に静的な引数や期待値を外部から書き換えると、計画が参照する値も変わる。
独立した値が必要なケースはsetupと `*From` を使う。

## 公開形式とシリアライズ

`TestPlan` はJavaScriptの構造化された値であり、JSON互換を保証する形式ではない。
関数・循環参照・オブジェクトの同一性を含み得る。
`JSON.stringify(plan)` では実行に必要な情報が欠落し、復元できない。

外部形式への変換が必要なら、受け取る側が保存できる要素と保存できない要素の扱いを決める。
そのために計画の構造を公開するが、特定の変換形式をmetadataの意味には含めない。

`version: 1` はこの構造と意味を識別する。
実行器は対応していないversionを実行前にエラーにし、不明な要素を黙って無視しない。
