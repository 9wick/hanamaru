# アサーション

`.expect()` に渡すコールバックが受け取る `e` には、次の 4 つが生えている。

| | 内容 |
|---|---|
| `e.result` | target の戻り値（Promise なら await 済み） |
| `e.error` | target が投げた例外 |
| `e.ctx` | `.setup()` の戻り値。マッチャではなく値そのもの |
| `e.mock(obj, key)` | モックの呼ばれ方 |

`.expect()` そのものをチェーンのどこに書くかは [it の中のビルダー](./api-it.md) を参照。

## `.expect()` の仕組み

```ts
expect(build: (e: Expect<F, M, C>) => Assertion[]): ItDone
```

コールバックは**アサーションの記述オブジェクトの配列**を返す。

マッチャは呼ばれた時点では**何も検証しない**。

```ts
e.result.toEqual({ id: 'u1' })
```

この式が評価された時点では、target はまだ呼ばれてすらいない。
`toEqual` がその場で比較を行うことも、失敗を投げることもない。返るのは
「戻り値が `{ id: 'u1' }` と深く等しいこと」という記述であり、ただの値である。

配列に詰められた記述をフレームワークが受け取り、target を呼んだ後に**全部**評価する。

```ts
.expect(e => [
  e.result.toEqual({ id: 'u1' }),
  e.mock(mailService, 'send').calledOnceWith({ id: 'u1' }),
])
```

この形には 2 つの帰結がある。

- アサーションの順序が実行順序と一致する必要がない。並んでいるのは条件であって手順ではない
- 配列に `Assertion` 以外を混ぜるとコンパイルエラーになる。マッチャの呼び忘れも同様に検出される

## `e.result`

target の戻り値。target が Promise を返す場合は await 済みの値が入る。
このページの例では `createUser` が `Promise<User>` を返すため、`e.result` の型は `User` になる。

| マッチャ | 意味 |
|---|---|
| `toBe(v)` | `Object.is` による同一性 |
| `toEqual(v)` | 再帰的な深い等価 |
| `toMatchObject(partial)` | 部分一致（指定したキーだけを見る） |
| `toSatisfy(fn)` | 述語関数が true を返すこと |

### `toBe(v)`

`Object.is` による同一性を記述する。

プリミティブ値、`null`、`undefined`、あるいは「この参照そのものが返ること」を確かめたいときに使う。
渡せる値は `e.result` の型に縛られるため、戻り値が `User` の `createUser` に対して
`e.result.toBe('u1')` と書くことはできない。プリミティブを返す target であれば次のように書ける。

```ts
// 戻り値が string | null 型の target の場合
declare function findUserId(input: CreateUserInput): Promise<string | null>

e.result.toBe('u1')
e.result.toBe(null)
```

### `toEqual(v)`

再帰的な深い等価を記述する。

```ts
e.result.toEqual({ id: 'u1' })
```

オブジェクトや配列の中身を丸ごと確かめたいときに使う。

### `toBe` と `toEqual` の違い

`toBe` は `Object.is` なので、**中身が同じでも別のオブジェクトなら一致しない**。

```ts
// createUser は userRepository.save が resolve した User をそのまま返す
e.result.toEqual({ id: 'u1' })   // 成功: 中身が深く等しい
e.result.toBe({ id: 'u1' })      // 失敗: 別のオブジェクト
```

オブジェクトの中身を見たいときは `toEqual`、プリミティブや参照同一性を見たいときは `toBe` を使う。

### `toMatchObject(partial)`

部分一致を記述する。指定したキーだけを見て、それ以外のキーの有無は問わない。

```ts
e.result.toMatchObject({ id: 'u1' })
```

戻り値に `id` 以外のキーが増えても、このアサーションは成立し続ける。

### `toEqual` と `toMatchObject` の違い

`toEqual` は**完全一致**、`toMatchObject` は**部分一致**である。

違いが出るのは、戻り値が `User` より多くのキーを持つ場合である。

```ts
// 戻り値が { id: string; createdAt: Date } 型の target の場合
declare function createUserWithTimestamp(input: CreateUserInput): Promise<{ id: string; createdAt: Date }>

e.result.toEqual({ id: 'u1', createdAt: new Date(0) })  // createdAt の値まで一致しないと失敗
e.result.toEqual({ id: 'u1' })                          // 型エラー: createdAt が足りない
e.result.toMatchObject({ id: 'u1' })                    // 成功: id だけを見る
```

生成日時のような「値を固定できないキー」を含む戻り値には `toMatchObject` を使う。
戻り値の形そのものを固定したいなら `toEqual` を使う。

部分一致であっても、**指定できるのは戻り値の型に存在するキーだけ**である。

```ts
e.result.toMatchObject({ ids: 'u1' })
//                       ^^^ 型エラー: User に ids は無い
```

### `toSatisfy(fn)`

述語関数が true を返すことを記述する。

```ts
e.result.toSatisfy(user => user.id.startsWith('u'))
```

`fn` は target の戻り値を受け取る。上の 3 つで書けない条件、たとえば
「値の範囲」「文字列の形」「配列の要素数」を確かめたいときに使う。

## `e.error`

target が投げた例外。

| マッチャ | 意味 |
|---|---|
| `toBeInstanceOf(Ctor)` | インスタンスであること |
| `toThrow(string \| RegExp)` | メッセージの部分一致 / 正規表現一致 |
| `toMatchObject(partial)` | 例外オブジェクトの部分一致 |
| `toSatisfy(fn)` | 述語関数が true を返すこと |

### `toBeInstanceOf(Ctor)`

例外が指定したコンストラクタのインスタンスであることを記述する。

```ts
e.error.toBeInstanceOf(Error)
e.error.toBeInstanceOf(ValidationError)
```

例外の種類だけを確かめたいときに使う。`createUser` の失敗系の例ではこれを使っている。

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

### `toThrow(string | RegExp)`

例外メッセージを確かめる。文字列を渡すと**部分一致**、正規表現を渡すと正規表現一致になる。

```ts
e.error.toThrow('save failed')      // メッセージに 'save failed' を含む
e.error.toThrow(/^save/)            // 正規表現に一致する
```

完全一致ではないため、メッセージに接頭辞や識別子が付いても成立する。

### `toMatchObject(partial)`

例外オブジェクトの部分一致を記述する。

```ts
e.error.toMatchObject({ code: 'E_SAVE' })
```

独自のエラークラスが持つプロパティを確かめたいときに使う。
`e.result` の `toMatchObject` と同じく、指定したキーだけを見る。

### `toSatisfy(fn)`

述語関数が true を返すことを記述する。

```ts
e.error.toSatisfy(err => err instanceof Error && err.message.length > 0)
```

複数の条件を 1 つのアサーションにまとめたいときや、上の 3 つで表せない条件に使う。

## `e.ctx`

`.setup()` の戻り値そのもの。**マッチャではなく値**である。

```ts
new Test()
  .target(createUser)
  .setup(() => ({ expectedId: 'u1' }))
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .mock(mailService, 'send', m => m.resolves(undefined))
  .it('保存して通知する', t => t
    .args({ name: 'Alice' })
    .expect(e => [
      e.result.toEqual({ id: e.ctx.expectedId }),
    ])
  )
```

`e.ctx` 自体にマッチャは生えていない。使い道は、上のように**他のマッチャの引数を組み立てること**である。

```ts
.expect(e => [
  e.result.toSatisfy(user => user.id === e.ctx.expectedId),
])
```

`e.ctx` から取り出した値をそのまま配列に入れることはできない。

```ts
.expect(e => [
  e.ctx.expectedId === 'u1',
  //  型エラー: これは boolean であって Assertion ではない
])
```

`.setup()` を呼んでいない場合、コンテキストは `{}` になる。`e.ctx.db` のようなアクセスは型エラーになる。

## `e.mock(obj, key)`

登録済みのモックの呼ばれ方を調べる。マッチャは `calledTimes` / `notCalled` / `calledWith` / `calledOnceWith` の 4 つで、
詳細は [モック](./api-mock.md) にまとめてある。

## `e.result` と `e.error` の関係

どちらを使ったかで、target が正常終了すべきか例外を投げるべきかが決まる。

- `e.result` を使ったのに target が例外を投げた → **失敗**。「予期しない例外」として、元の例外とスタックトレースを添えて報告される
- `e.error` を使ったのに target が正常終了した → **失敗**。「例外が発生しませんでした」と報告される

そのため、「例外が起きないこと」を書くための専用のマッチャは要らない。
`e.result` を使った時点で、例外が起きないことは前提として検査されている。

同じ `.expect()` の中で `e.result` と `e.error` を両方使うことは可能だが、
target は正常終了するか例外を投げるかのどちらかなので、**必ずどちらかが失敗する**。

## 失敗は集約して報告される

アサーションは 1 つ落ちても後続が評価される。失敗はまとめて報告される。

```console
✗ 保存して通知する

  2 件のアサーションが失敗しました

  [1] result.toEqual
      - expected: { id: 'u1' }
      + actual:   { id: 'u2' }

  [2] mock(mailService.send).calledOnceWith
      expected: 1 回 { id: 'u1' } で呼ばれること
      actual:   0 回
```

最初の失敗で打ち切られないため、「結果も違うし通知も飛んでいない」が一度の実行で分かる。
1 つ直して再実行して次の失敗を見る、という往復が要らない。

評価の順序や復元のタイミングは [実行セマンティクス](./semantics.md) を参照。

## 型エラーになるケース

| 書いたもの | 結果 |
|---|---|
| `e.result.toEqual({ id: 123 })`（戻り値型違い） | 型エラー |
| `e.result.toMatchObject({ ids: 'u1' })`（存在しないキー） | 型エラー |
| `.expect(e => [true])`（`Assertion` でない値） | 型エラー |
| `.expect(e => [e.mock(userRepository, 'save')])`（マッチャ呼び忘れ） | 型エラー |
| `.setup()` なしで `e.ctx.db` | 型エラー |
| 登録していないモックを `e.mock()` で参照 | 型エラー |

最後の 2 つはアサーションそのものではなく、`e` の組み立て方の誤りである。

`.expect(e => [true])` と `.expect(e => [e.mock(repo, 'save')])` が検出されるのは、
コールバックの戻り値型が `Assertion[]` に固定されており、`Assertion` が
`unique symbol` によるブランド型として定義されているため。
`boolean` も、マッチャを呼ぶ前の `MockAssertions` も `Assertion` には代入できない。

仕組みの詳細は [型推論](./type-inference.md) を参照。

なお hanamaru 自身は型チェックを行わない。上記はすべて `tsc --noEmit` で検出するものである。
詳細は [制約](./limitations.md) を参照。
