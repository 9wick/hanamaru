# Testビルダー

`Test` はテストの実行計画を組み立てる入口である。
このページのAPIは設計仕様。[型契約](./spec/hanamaru.d.ts)と[実装状況](./limitations.md)を参照。

## 全体の順序

```ts
new Test()
  .setup(create, dispose)                 // 任意。targetの前に1回
  .target(fn)                            // 対象を1回だけ確定
  .describe('見出し')                     // 任意。ケース追加前
  .mock('dependency', obj, 'method', m => m.returns(value))
  .it('ケース', t => t.args(input).expect(e => [e.result.toBe(expected)]))
  .it('別のケース', t => t.args(otherInput).expect())
```

| 段階 | できる操作 |
|---|---|
| `new Test()` | `setup` または `target` / `targetFrom` |
| setup後 (`TargetStage<C>`) | `target` / `targetFrom` |
| target後 (`TestBuilder<F, M, C>`) | `describe` / `mock` / `mockFrom` / ケース追加 |
| ケース追加後 (`Suite<F, M, C>`) | `it` / `only` / `skip` / `todo` / `plan` |

各操作は新しいビルダーを返す。元の値と既存の計画を変更しない。
設定途中の値を保存して別のケース群を作る方法は[再利用](./reuse.md)を参照。

## `.setup(create, dispose?)`

```ts
setup<S>(
  create: () => S,
  dispose?: (ctx: Awaited<S>) => void | Promise<void>,
): TargetStage<Awaited<S>>
```

各ケースの実行時に `create` を1回呼び、Promiseならawaitする。
その結果がコンテキスト `C` になる。`dispose` は同じ値を受け取り、ケース終了時に呼ばれる。

```ts
new Test()
  .setup(async () => ({ db: await openTestDb() }), ctx => ctx.db.close())
  .targetFrom(ctx => ctx.db.find.bind(ctx.db), { name: 'Database.find' })
```

`setup` は1回だけ指定できる。複数の資源が必要なら一つのfixtureにまとめる。
省略時のコンテキストは `{}`。実行時まで生成しないので、定義中に値を直接参照するAPIはない。

targetを選んだ後やケース追加後にsetupを差し替えることは型エラーになる。
生成途中の失敗と後始末の範囲は[セマンティクス](./semantics.md)に定める。

## `.target()`

```ts
.target(add)
.target(service, 'create')
.target(add, { name: '足し算', source: { file: 'src/math.ts', exportName: 'add' } })
```

関数を渡す形と、オブジェクト・メソッド名を渡す形がある。
後者は受け手を保持し、元のメソッドをそのオブジェクトを `this` にして呼ぶ。
第2引数には、存在が保証された関数型の文字列キーだけを指定できる。
省略可能なメソッド・非関数プロパティ・存在しないキーは指定できない。

関数型 `F` から、引数は `Parameters<F>`、結果は `Awaited<ReturnType<F>>` と決まる。
targetは一度選んだら変更できない。

`name` は対象の表示名。省略時は関数の `name`、メソッド形式ならコンストラクタ名とキーから得る。
通常のオブジェクトは `Object.create` のような名前になり、変数名は復元しない。
匿名関数は `<anonymous>` とする。必要なら明示する。

`source` は任意の注釈で、プロジェクトルート相対の `file`、`exportName`、任意の `member` を持つ。
参照をソースから自動解析したという意味ではなく、実行時の対象解決にも使用しない。

## `.targetFrom(get, options)`

```ts
new Test()
  .setup(() => makeFixture())
  .targetFrom(ctx => ctx.service.create.bind(ctx.service), {
    name: 'UserService.create',
  })
```

setupで作った値から対象関数を得る。
`get` はケース実行時にsetup後、モック適用前に1回呼ばれ、同期的に関数を返す。
非同期の準備はsetupへ置く。返された対象関数自身は非同期でもよい。

この形式では、呼び出すまで関数名が分からないため `options.name` が必須。
メソッドの `this` が必要なら例のようにbindするか、呼び出しを包む関数を返す。

## `.describe(name)`

テスト全体の見出しを指定する。省略時はtarget名。
対象関数や型は変えない。ケース追加前にのみ呼べる。

## `.mock()` / `.mockFrom()`

```ts
.mock('save', repository, 'save', m => m.resolves(user))
.mockFrom('save', ctx => ctx.repository, 'save', m => m.resolves(user))
```

全ケースの既定のモックを登録する。登録名はテスト内で一意の文字列リテラル。
動的な文字列名や既存名での再登録は型エラーになる。
ケースごとに振る舞いを変えるにはケース内の `.override()` を使う。
詳細は[モック](./api-mock.md)を参照。

## `.it()` / `.only()` / `.skip()` / `.todo()`

```ts
.it('足す', t => t.args(1, 2).expect(e => [e.result.toBe(3)]), { id: 'addition' })
.only('確認中', t => t.args(0, 0).expect())
.skip('修正待ち', t => t.args(1, 1).expect(e => [e.result.toBe(2)]))
.todo('オーバーフローの扱い')
```

最初のいずれかを呼ぶと共通設定が固定され、戻り値は `Suite` になる。
`only` / `skip` も `it` と同じ型付きのケース本体を持つ。`todo` は本体を持たない。
`skip` の本体も計画を作るため定義時に評価されるが、setup・targetは実行されない。

ケース名とは別のIDが必要なら、最後の引数へ `{ id: 'addition' }` を渡す。
省略時のIDはケース名そのもの。IDは同じテスト内で一意でなければならない。
ケースの宣言位置を注釈する `source: { file, line, column }` も指定できる。
lineとcolumnは1始まり。重複ID、不正な位置、空の名前・IDは定義エラーになる。

`only` の有効範囲、skip/todoの結果は[実行セマンティクス](./semantics.md)に定める。

## `.plan()`

完成済みの `Suite` にだけ存在する。

```ts
const plan = tests.plan()
```

公開された `TestPlan<F, C>` を返す。この値がmetadataであり、`run(plan)` の入力になる。
各ケースの共通モックとケース内の上書きは、実効的なモック一覧へ正規化される。

`.plan()` を繰り返し呼んでもsetup・target・遅延値の関数は実行されない。
計画の取得だけでは実行は始まらない。構造は[metadata](./metadata.md)を参照。
