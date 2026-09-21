# hanamaru

**テストを型付きの実行計画として書く、TypeScriptテストフレームワーク。**

対象・準備・モック・引数・期待を宣言すると、「何をどうテストするか」を表す値ができる。
その実行計画がmetadataであり、計画を作ることと実行することは分かれている。

> 現在はAPI設計段階です。このリポジトリには仕様・型契約・サンプルがあり、ランナーの実装はまだありません。以下のAPIとCLIは実装する契約です。

## テストを書く

対象は `add(a: number, b: number): number`。完全な対象コードと設定は[はじめる](docs/getting-started.md)にある。

```ts
import { Test } from 'hanamaru'
import { add } from './math.ts'

export const addition = new Test()
  .target(add, { source: { file: 'src/math.ts', exportName: 'add' } })
  .it('2つの数を足す', t => t.args(1, 2).expect(e => [
    e.result.toBe(3),
  ]), { id: 'adds-two-numbers' })
```

`.target()` で引数・戻り値の型が決まり、`.args()` で入力、`.expect()` で期待を書く。
`expect` は正常終了を期待する。例外を期待するときは `expectError` を使う。

```ts
// 型エラーになる操作
.args('1', 2)                         // add の引数と違う
.expect(e => [e.error.toThrow('x')])   // 正常終了の期待に error はない
```

設定はケースを書く前に確定する。ケース追加後にtarget・setup・共通mockを変更するメソッドは存在しない。

## 計画を得る

```ts
const plan = addition.plan()
```

この時点で `add` は呼ばれない。`plan` は公開された `TestPlan` で、例えば次の構造を持つ。
以下はオブジェクト表示の抜粋。`add` は関数への参照である。

```ts
{
  version: 1,
  name: 'add',
  target: { kind: 'function', fn: add, /* 任意のsource情報 */ },
  setup: null,
  cases: [{
    id: 'adds-two-numbers',
    name: '2つの数を足す',
    mode: 'run',
    mocks: [],
    args: { kind: 'value', value: [1, 2] },
    outcome: {
      kind: 'return',
      assertions: [{
        subject: 'result',
        check: { matcher: 'toBe', expected: { kind: 'value', value: 3 } },
      }],
    },
  }],
}
```

metadataの内容はテストの構造から決まる。特定の利用目的や出力形式を前提にしない。
関数・オブジェクトへの参照、実行時に評価する関数も計画の要素になる。
全フィールドと評価タイミングは[実行計画とmetadata](docs/metadata.md)を参照。

## 計画を実行する

```ts
import { run } from 'hanamaru'

const result = await run(plan)
```

`run` が計画を受け取り、準備・呼び出し・検証・後始末を行う。
CLIもexportされたテストから同じ計画を取得し、同じ実行器に渡す。

```console
npx hanamaru
```

## 依存の振る舞いも計画にする

```ts
import { Test } from 'hanamaru'
import { createUser, userRepository, mailService } from './user.ts'

export const users = new Test()
  .target(createUser, { source: { file: 'src/user.ts', exportName: 'createUser' } })
  .mock('save', userRepository, 'save', m => m.resolves({ id: 'u1', name: 'Alice' }))
  .mock('send', mailService, 'send', m => m.resolves(undefined))
  .it('保存して通知する', t => t
    .args({ name: 'Alice' })
    .expect(e => [
      e.result.toEqual({ id: 'u1', name: 'Alice' }),
      e.mock('save').calledOnceWith({ name: 'Alice' }),
      e.mock('send').calledOnceWith({ id: 'u1', name: 'Alice' }),
    ]), { id: 'save-and-notify' })
  .it('保存に失敗したら通知しない', t => t
    .override('save', m => m.rejects(new Error('save failed')))
    .args({ name: 'Alice' })
    .expectError(e => [
      e.error.toThrow('save failed'),
      e.mock('send').notCalled(),
    ]), { id: 'save-failure' })
```

モックは名前で登録・参照する。`e.mock('send')` は登録済みの名前だけを受け付け、引数型も元のメソッドから決まる。
`override` は登録先を変えず、そのケースの振る舞いだけを置き換える。

この例の対象コードは[サンプル](docs/examples/user.ts)、APIは[モック](docs/api-mock.md)にある。

## 値として組み立て、再利用する

`Test` の操作は新しいビルダーを返す。共通の設定からケースを分岐できる。
同じケースを別の依存実装に適用するときは、型付きの関数として定義を再利用する。
[再利用の例](docs/reuse.md)では、2種類のStoreに同じ仕様を適用している。

Hono的な点は、定義を値として組み立て、外側へ渡せること。
hanamaruでは、その値が公開された実行計画に結び付いている。

## ドキュメント

- [はじめる](docs/getting-started.md) — 完全な最小例と型チェック
- [考え方](docs/concepts.md) — 計画と実行の分離
- [実行計画とmetadata](docs/metadata.md) — 公開構造と遅延評価
- [再利用](docs/reuse.md) — 同じケースを異なる実装へ適用する
- [Testビルダー](docs/api-test.md) / [ケースビルダー](docs/api-it.md)
- [アサーション](docs/api-expect.md) / [モック](docs/api-mock.md)
- [型の契約](docs/type-inference.md) — 防ぐ誤操作と限界
- [実行セマンティクス](docs/semantics.md) / [CLI](docs/cli.md)
- [制約と実装状況](docs/limitations.md)

ランタイムの依存パッケージは0を目標とする。型チェックには開発依存のTypeScriptを使う。
このリポジトリの型契約とサンプルは次で検証できる。

```console
tsc -p docs/spec/tsconfig.json
```

## ライセンス

MIT
