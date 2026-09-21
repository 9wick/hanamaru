# ケースビルダー

`.it(name, t => ...)` のコールバックは、1ケースの計画を組み立てて終端値を返す。

```ts
.it('保存して通知する', t => t
  .override('save', m => m.resolves({ id: 'u1', name: 'Alice' }))
  .args({ name: 'Alice' })
  .expect(e => [
    e.result.toEqual({ id: 'u1', name: 'Alice' }),
    e.mock('send').calledOnceWith({ id: 'u1', name: 'Alice' }),
  ]))
```

## 順序

```text
ItBuilder → args または argsFrom → ItArgs → expect または expectError → ItDone
```

- `args` / `argsFrom` はどちらか一方を1回必ず呼ぶ。引数なしの関数にも `.args()` を書く。
- `expect` / `expectError` はどちらか一方でケースを閉じる。
- `.mock()` / `.mockFrom()` / `.override()` は引数指定の前後どちらでも書ける。
- `ItDone` には後続のビルダーメソッドがない。

コールバックは同期的に `ItDone` を返す。ケース定義をasyncにしない。
実行時の非同期処理はsetup・target・mockの振る舞いに置く。

## `.args(...args)`

対象の引数をそのまま指定する。型は `Parameters<F>`。

```ts
.args(1, 2)
.args(() => doSomething()) // targetが関数を引数に取るなら、関数そのものを渡す
```

関数型の引数と、引数を作る関数を混同しないよう、後者は `argsFrom` に分けている。

## `.argsFrom(label, build)`

```ts
new Test()
  .setup(() => ({ input: { name: 'Alice' } }))
  .target(createUser)
  .it('fixtureを渡す', t => t
    .argsFrom('fixtureの入力', ctx => [ctx.input])
    .expect())
```

`build` は実行時にそのケースのコンテキストを受け取り、引数のタプルを同期的に返す。
labelは、この遅延した定義の説明として計画に保持する。関数本体から説明文を生成しない。
非同期の準備はsetupで済ませる。

## `.mock()` / `.mockFrom()` / `.override()`

ケース内の登録はそのケースだけに効き、他のケースの型・計画には追加されない。

```ts
.mock('send', mailService, 'send', m => m.resolves(undefined)) // このケースで追加
.override('save', m => m.rejects(new Error('save failed')))  // 既存登録の振る舞いを変更
```

登録名の重複は許さない。`override` は登録済みの名前だけに使え、対象オブジェクトとメソッドは変えない。
同じケースで複数回overrideした場合、最後の振る舞いを計画に保存する。

## `.expect(build?)`

targetの正常終了を要求する。コールバックには `result` と登録済み `mock()` がある。

```ts
.expect(e => [e.mock('send').notCalled()])
```

モックだけを検証していても、targetの例外は失敗になる。
戻り値や呼び出しについて追加条件が不要なら `.expect()` と書く。これは正常終了のみの検証である。

## `.expectError(build?)`

targetの例外送出またはPromiseのrejectを要求する。
コールバックには `error` と登録済み `mock()` があり、`result` はない。

```ts
.expectError(e => [
  e.error.toThrow('save failed'),
  e.mock('send').notCalled(),
])
```

単に例外送出を要求するなら `.expectError()` と書く。
準備・引数生成・後始末の例外ではこの期待を満たせない。

## アサーションの配列

コールバックを渡す場合、1つ以上の `Assertion` を返す。
空配列を返す書き間違いは型エラーにし、結果の種類だけを期待する場合は引数なしで明示する。

```ts
.expect(() => [])                   // 型エラー
.expect(e => [true])                // 型エラー
.expect(e => [e.result])            // 型エラー: マッチャを呼んでいない
.expect(e => [e.error.toThrow('x')]) // 型エラー: 正常系にerrorはない
```

`expect` のコールバックは定義時に評価される。
コンテキスト由来の期待値には `toEqualFrom` などを使い、実際の値の検証は実行器に任せる。
[アサーション](./api-expect.md)を参照。
