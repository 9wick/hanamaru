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
| 対象・子を追加する前 | describe、setup、mock、target、group |
| 対象を決めた後、ケースの前 | describe、setup、mock、it / only / skip / todo |
| 最初のケースを追加した後 | it / only / skip / todo、plan |
| 最初のgroupを追加した後 | group、plan |

対象は一度決めたら固定します。最初のケース・group以降は共通設定も固定します。
対象を持つテストと、子を持つグループのどちらも `new Test()` から作れます。
グループ自体は対象・ケースを持たず、子ごとに異なる対象をまとめられます。
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
グループにも設定できます。グループでは省略時に名前を補わず、計画のnameをnullにします。

## group

```ts
const tests = new Test()
  .mock(mailService, 'send', m => m.resolves(undefined))
  .group(userTests)
  .group('退会', deletionTests)
```

完成済みのテストまたはグループを合成します。名前は任意で、一意性も要求しません。
`group(name, child)` の名前はその合成箇所の説明であり、元の子のdescribeを変更しません。
親のmock・setupは配下の全ケースへ、子の設定はその子の配下だけへ適用します。
同じ子を別の親や同じ親の複数箇所へ合成することもでき、それぞれ独立した実行箇所になります。

子は元のctxの型を保ちます。親のctxが必要な子は `new Test<Ctx>()` で要求する型を宣言します。
親がその型を満たさない合成は型エラーです。詳しくは[テストの合成とスコープ](./composition.md)を参照してください。

## setup

```ts
new Test()
  .target(add)
  .setup(async () => ({ a: 1, expected: 3 }))
  .it('準備した値を使う', t => t
    .argsFrom(ctx => [ctx.a, 2])
    .expect(e => [e.result.toBe(e.ctx.expected)]))
```

`setup(create, dispose?)` のcreateは、それまでのctxを受け取り、追加するフィールドを持つplain objectを返します。
DB等の資源は `{ db }` のようにフィールドへ入れます。
Promiseならawaitした戻り値を使います。引数が不要なら、上の例のように省略できます。
複数のsetupは登録順に実行し、戻り値のフィールドを順に引き継ぎます。同名のフィールドは後の値・型を優先します。

```ts
new Test()
  .setup(() => ({ a: 1 }))
  .setup(ctx => ({ expected: ctx.a + 2 }))
  .target(add)
  .it('準備を積み重ねる', t => t
    .argsFrom(ctx => [ctx.a, 2])
    .expect(e => [e.result.toBe(e.ctx.expected)]))
```

各ケースは新しい `{}` から始め、親から子の順にsetupを実行します。
最終的なctxがargsFromとe.ctxに渡ります。setup・mockは最初のケース・groupより前ならどちらの順でも書けます。
ctxのフィールドは読み取り専用ですが、フィールドが参照するオブジェクト自体は共有します。

成功したsetupのdisposeは、ケースが失敗しても逆順に呼びます。
各disposeには対応するcreate直後のctxを渡し、後のsetupで追加・上書きしたフィールドは見せません。
[実行セマンティクス](./semantics.md)に失敗時を含む手順を定めます。

## mock

```ts
.mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
```

配下のケースに共通するモックを定義します。対象と振る舞いを一緒に指定します。
同じオブジェクトの同じキーへの登録は、同一スコープ内では後勝ち、階層間では内側を優先します。
ケース内の同じ `.mock()` で、そのケースだけ上書きできます。
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

1ケース以上あるテスト、または完成済みの子を1つ以上持つグループから、読み取り専用の実行計画を取得します。
todoだけの定義も含みます。
setupやtargetは実行しません。戻り値の構造は[実行計画とmetadata](./metadata.md)を参照してください。
親ctxを要求する定義でも計画は取得できますが、そのままrunへ渡すと型エラーです。
CLIに収集させるファイルでは、必要なctxを用意したルートをexportします。
