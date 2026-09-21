# アサーション

アサーションは、対象と検証方法を持つ計画の要素である。
マッチャの呼び出しは記述を作り、比較は `run()` が行う。

## 正常系と例外系

| 終端 | 期待 | コールバックにあるもの |
|---|---|---|
| `.expect()` | 正常終了（Promiseならresolve） | `e.result` / `e.mock(name)` |
| `.expectError()` | 例外送出（Promiseならreject） | `e.error` / `e.mock(name)` |

コールバックなしなら、終了の種類だけを検証する。
コールバックを渡す場合は1件以上のアサーションが必要。

`e.result` と `e.error` は、実際の戻り値や例外オブジェクトではない。
記述を作るためのマッチャ群である。`e.result.id` のようなプロパティアクセスはできない。

## `e.result`

期待値の型は `Awaited<ReturnType<F>>` に対応する。

| マッチャ | 意味 |
|---|---|
| `toBe(value)` | `Object.is` による一致 |
| `toEqual(value)` | 深い厳密な等価 |
| `toMatchObject(partial)` | 指定したトップレベルのキーの値が深く等しい |
| `toSatisfy(label, predicate)` | 述語がtrueを返す |
| `toBeFrom(label, get)` | コンテキストから期待値を得て `toBe` |
| `toEqualFrom(label, get)` | コンテキストから期待値を得て `toEqual` |

```ts
.expect(e => [
  e.result.toEqual({ id: 'u1', name: 'Alice' }),
  e.result.toMatchObject({ id: 'u1' }),
  e.result.toSatisfy('IDはuから始まる', user => user.id.startsWith('u')),
])
```

`toBe` は参照の同一性も検証する。別々に作ったオブジェクト同士は、中身が同じでも一致しない。
`toEqual` は返り値の型全体を要求する。キーの一部を指定したい場合は `toMatchObject` を使う。

`toMatchObject` の型は `Partial<V>`。指定した各キーの値は深い等価で比べ、ネストした部分一致ではない。
必須の子プロパティを省いたり、戻り値にないキーを指定したりはできない。
プリミティブ値には使用できない。

## コンテキストから期待を作る

```ts
new Test()
  .setup(() => ({ expected: 3 }))
  .target(add)
  .it('期待値と等しい', t => t.args(1, 2).expect(e => [
    e.result.toEqualFrom('fixtureの期待値', ctx => ctx.expected),
    e.result.toSatisfy('期待値以上', (actual, ctx) => actual >= ctx.expected),
  ]))
```

`e.ctx` は提供しない。定義時にはsetupの値がまだ存在しないためである。
`*From` の関数と `toSatisfy` の述語は計画に保持し、実行時のアサーション評価で呼ぶ。
それらが読むctxはtarget実行後の同じコンテキストなので、変更される値はその時点の状態になる。
実行前の値を期待するならsetup時に別のフィールドへ保存しておく。

`toSatisfy` は `(actual, ctx) => boolean`。同期述語に限定し、Promiseを返す関数は型エラーにする。
述語の説明labelも計画に残る。関数本体を解析して条件を推測することはない。

## `e.error`

TypeScriptはthrowされる値の型を関数シグネチャに持たない。
述語が受け取る例外は `unknown` として扱う。

| マッチャ | 意味 |
|---|---|
| `toBeInstanceOf(Ctor)` | `instanceof` が成立する |
| `toThrow(string \| RegExp)` | Errorのmessageが文字列を含む、または正規表現に一致する |
| `toMatchObject(partial)` | 指定したキーが例外にあり、その値が深く等しい |
| `toSatisfy(label, predicate)` | 例外とctxを受け取る述語がtrueを返す |

```ts
.expectError(e => [
  e.error.toBeInstanceOf(Error),
  e.error.toThrow(/^save/),
  e.error.toSatisfy('空でないエラーメッセージ', err =>
    err instanceof Error && err.message.length > 0),
])
```

`toThrow` の文字列は部分一致。正規表現は評価ごとに `lastIndex` に依存しない形で比較する。
Error以外の値がthrowされた場合、`toThrow` は不一致になる。
`throw undefined` も例外送出であり、正常に `undefined` を返すこととは区別する。

## `e.mock(name)`

登録名から呼び出しの検証を記述する。正常系・例外系の両方にある。

```ts
.expect(e => [e.mock('send').calledOnceWith({ id: 'u1', name: 'Alice' })])
```

回数・引数の規則とコンテキスト由来の引数は[モック](./api-mock.md)を参照。

## 失敗をまとめる

期待した終了の種類と実際の結果を先に照合し、その後にアサーションを評価する。
対象の結果が存在しないアサーションは「評価不能」と報告し、残りのモックの検証は続ける。
述語や期待値の生成がthrowした場合もそのアサーションの失敗として残し、後続へ進む。

`toSatisfy` の中に複数条件を書くと、それらは1つのアサーションになる。
別々に失敗を報告したい条件は、配列の別要素として書く。

正確な実行順は[実行セマンティクス](./semantics.md)を参照。
