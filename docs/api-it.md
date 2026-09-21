# it ビルダー

ケースでは、必要ならモックを上書きし、引数を決め、期待を返します。

```ts
.it('保存に失敗したら通知しない', t => t
  .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
  .args({ name: 'Alice' })
  .expect(e => [
    e.error.toBeInstanceOf(Error),
    e.mock(mailService, 'send').notCalled(),
  ])
)
```

## args / argsFrom

`.args(...args)` は対象の引数をそのまま受け取ります。
`.argsFrom(ctx => [...args])` はsetupの戻り値から引数タプルを作ります。

```ts
.args(1, 2)
.argsFrom(ctx => [ctx.a, ctx.b])
```

上記は二者択一です。引数は一度だけ確定し、それまではexpectを呼べません。
引数のない関数にも `.args()` を書きます。
argsFromはケースの実行時、setupの後・targetの前に1回評価します。

## mock

`.mock(obj, key, def)` はTestレベルと同じAPIです。
同じ参照・同じキーなら共通設定の振る舞いを置き換え、新しい組ならそのケースだけに追加します。
argsの前でも後でも書けます。適用順序は記述位置にかかわらず[実行セマンティクス](./semantics.md)に従います。

## expect

```ts
.expect(e => [
  e.result.toEqual({ id: 'u1' }),
  e.mock(mailService, 'send').calledOnceWith({ id: 'u1' }),
])
```

1つ以上のアサーションを配列で返します。各マッチャは検証内容の記述子を作り、実行器がそれを評価します。
配列の要素を省略したり、マッチャを呼ばずに返したりすると型エラーです。
expectの後には操作を続けられません。

| 返したアサーション | 期待する終了 |
|---|---|
| resultを含む | 正常終了 |
| errorを含む | throw / reject |
| mockだけ | 正常終了 |
| resultとerrorの両方 | 型エラー。実行時も不正な期待として失敗 |
| 空配列 | 型エラー。実行時も不正な期待として失敗 |

判断に使うのは**返した配列**です。返していない `e.error.toThrow(...)` を途中で呼んでも、期待は変わりません。
例外を期待したのに正常終了した場合も、その逆も失敗です。

expectのコールバックはtarget終了後に1回評価します。`e.ctx` はsetupが返した実際の値です。
`e.result` と `e.error` は値そのものではなく、記述子を作るためのマッチャです。
そのため例外が起きたケースでもresultの記述子を作ることはできますが、実際の終了と合わなければ失敗します。

コールバック自体のthrowはテストの失敗です。targetが投げた例外として検証することはできません。

マッチャの一覧は[マッチャ](./api-expect.md)、型の仕組みは[型推論](./type-inference.md)を参照してください。
