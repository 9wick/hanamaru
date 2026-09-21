# Test ビルダー

`new Test()` から対象・共通設定・ケースをつないで定義します。
ここではテストを実行しません。

```ts
const users = new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .it('保存して通知する', t => t
    .args({ name: 'Alice' })
    .expect(e => [
      e.result.toEqual({ id: 'u1' }),
    ])
    .expectCalls(call => [
      call(mailService, 'send').calledOnceWith({ id: 'u1' }),
    ]))
```

## 定義の段階

| 段階 | 使える操作 |
|---|---|
| 対象を決める前 | target、setup |
| 対象を決めた後、ケースの前 | describe、setup、mock、it / only / skip / todo |
| 最初のケースを追加した後 | it / only / skip / todo、plan |

対象は一度決めたら固定します。最初のケース以降は共通設定も固定します。
setupを先に書く場合は `.setup(create, dispose).target(fn)` の順にも書けます。
各メソッドは新しいビルダーを返すため、元のビルダーから別の派生を作れます。

```ts
const base = new Test().target(add)
const tests = base.it('足す', t => t.args(1, 2).expect(e => [e.result.toBe(3)]))

// tests.setup(...) は型エラー。既存ケースのctxを後から変えられない。
// base.setup(...) は可能。ケースを含まない別の派生になる。
```

## target

```ts
new Test().target(createUser)
new Test().target(userService, 'create')
```

関数、またはオブジェクトとメソッド名を渡します。
後者は `this` をそのオブジェクトに束縛します。非関数のキーや省略可能なメソッドは型エラーです。
関数の型から、argsの `Parameters<F>` とresultの `Awaited<ReturnType<F>>` が決まります。
追加の名前やソース情報は不要です。

## describe

```ts
new Test().target(createUser).describe('ユーザー作成')
```

任意の表示名です。省略時は関数名、メソッド形式ではメソッド名を使います。
名前のない関数には `anonymous` を使います。表示名をソース上の識別情報とは扱いません。

## setup

```ts
new Test()
  .target(add)
  .setup(async () => ({ a: 1, expected: 3 }))
  .it('準備した値を使う', t => t
    .argsFrom(ctx => [ctx.a, 2])
    .expect(e => [e.result.toBe(e.ctx.expected)]))
```

`setup(create, dispose?)` のcreateをケースごとに呼び、Promiseならawaitします。
得られたctxは `argsFrom`、`e.ctx`、disposeに同じ型で渡ります。省略時は新しい `{}` です。

共通モックの前でも後でも書けます。ケース追加前にsetupをもう一度書くと、createとdisposeを一組で置き換えます。
createが成功した後は、ケースの失敗時にもdisposeを呼ぶ契約です。[実行セマンティクス](./semantics.md)を参照してください。

## mock

```ts
.mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
```

以降のケースに共通するモックを定義します。対象と振る舞いを一緒に指定します。
同じオブジェクトの同じキーへの登録は後勝ちです。ケース内の同じ `.mock()` で、そのケースだけ上書きできます。
モックは[モックAPI](./api-mock.md)に詳しく記載しています。

## it / only / skip / todo

```ts
.it('保存する', t => t.args({ name: 'Alice' }).expect(e => [e.result.toEqual({ id: 'u1' })]))
.only('集中して確認する', t => t.args({ name: 'Bob' }).expect(e => [e.result.toEqual({ id: 'u1' })]))
.skip('修正待ち', t => t.args({ name: 'Carol' }).expect(e => [e.result.toEqual({ id: 'u1' })]))
.todo('送信失敗時の扱い')
```

it / only / skipは、ケース名と、expectまたはexpectCallsを1つ以上設定したケースを返すコールバックを受け取ります。
expectとexpectCallsはそれぞれ1回ずつ、どちらの順でも書けます。
todoは名前だけを受け取ります。名前の一意性は要求しません。
ケース内で追加・上書きしたモックは次のケースに漏れません。

実行器に渡す計画全体にonlyがあればonlyだけを実行します。skipとtodoではsetup・targetを呼びません。
詳細は[it ビルダー](./api-it.md)と[実行セマンティクス](./semantics.md)を参照してください。

## plan

```ts
const plan = users.plan()
```

1ケース以上ある定義から、読み取り専用の実行計画を取得します。todoだけの定義も含みます。
setupやtargetは実行しません。戻り値の構造は[実行計画とmetadata](./metadata.md)を参照してください。
完成した定義をexportするとCLIが収集します。
