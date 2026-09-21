# モック

hanamaru のモックは 2 つの面を持つ。

- **定義する**: `.mock(obj, 'method', m => behavior)` で依存の振る舞いを宣言する
- **検証する**: `.expect()` の中で `e.mock(obj, 'method')` から呼ばれ方を調べる

この 2 つが同じ `(obj, key)` の組で対応しているのが hanamaru のモックの基本形である。

```ts
new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))   // 定義
  .mock(mailService, 'send', m => m.resolves(undefined))         // 定義
  .it('保存して通知する', t => t
    .args({ name: 'Alice' })
    .expect(e => [
      e.mock(mailService, 'send').calledOnceWith({ id: 'u1' }),   // 検証
    ])
  )
```

## モックを定義する

### `.mock(obj, key, def)`

```ts
mock<O, K extends FnKeys<O>>(obj: O, key: K, def: MockDef<O, K>): TestBuilder<F, [...M, { obj: O; key: K }], C>
```

`obj` の `key` プロパティを、第3引数のコールバックが宣言した振る舞いに差し替える。

第2引数に渡せるのは `obj` の**関数型のプロパティのキーのみ**。非関数プロパティや存在しないキーは型エラーになる。

`Test` レベルと `it` レベルのどちらでも同じ形で書ける。
`Test` レベルに書けば全ケース共通の前提になり、`it` レベルに書けばそのケースだけの前提になる。
`it` レベルでの書き方と上書きの規則は [it の中のビルダー](./api-it.md) を参照。

第3引数のコールバックが受け取る `m` から選べる振る舞いは次の 5 つで、これがすべてである。

| 記法 | 意味 |
|---|---|
| `m.returns(v)` | 同期的に `v` を返す |
| `m.resolves(v)` | `Promise.resolve(v)` を返す |
| `m.throws(e)` | 同期的に `e` を投げる |
| `m.rejects(e)` | `Promise.reject(e)` を返す |
| `m.callsFake(fn)` | `fn` を代わりに呼ぶ |

### `m.returns(v)`

同期的に `v` を返す。

差し替える対象が同期関数のときに使う。`v` の型は対象メソッドの `ReturnType` に縛られる。

このページの共通の例には同期メソッドが1つも無いため、同期の振る舞いを説明する箇所では
補助的なオブジェクト `clock` を使う。

```ts
declare const clock: { now(): number }

new Test()
  .target(createUser)
  .mock(clock, 'now', m => m.returns(1700000000000))
```

`now()` の戻り値型は `number` なので、`m.returns('now')` のような書き方は型エラーになる。

### `m.resolves(v)`

`Promise.resolve(v)` を返す。

非同期メソッドの成功系を宣言するときに使う。`v` の型は対象メソッドの `Awaited<ReturnType>` に縛られる。
`Promise<User>` を返すメソッドなら、渡すのは `Promise<User>` ではなく `User` である。

```ts
.mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
.mock(mailService, 'send', m => m.resolves(undefined))
```

`mailService.send` は `Promise<void>` を返すため、`m.resolves(undefined)` と書く。

型エラーになる例。

```ts
.mock(userRepository, 'save', m => m.resolves({ nope: 1 }))
//                                              ^^^^ 型エラー: User に nope は無い
```

### `m.throws(e)`

同期的に `e` を投げる。

差し替える対象が同期関数で、その中で例外が起きる状況を作りたいときに使う。

```ts
declare const clock: { now(): number }

.mock(clock, 'now', m => m.throws(new Error('clock unavailable')))
```

target がこの例外をそのまま外に漏らすなら、`.expect()` では `e.error` で受ける。
target が内部で握って別の結果を返すなら `e.result` で受ける。
`e.result` と `e.error` の使い分けは [アサーション](./api-expect.md) を参照。

### `m.rejects(e)`

`Promise.reject(e)` を返す。

非同期メソッドの失敗系を宣言するときに使う。これまでの例では、保存の失敗を作るのに使っている。

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

`userRepository.save` が reject すると `createUser` は `mailService.send` に到達しない。
それを `notCalled()` で確かめている。

### `m.callsFake(fn)`

`fn` を代わりに呼ぶ。

上の 4 つは「何が返るか」を固定するが、`callsFake` は**引数を受け取って動的に振る舞いを変えたい**ときに使う。
呼び出しごとに違う値を返したい、引数に応じて成功と失敗を切り替えたい、といった場合が該当する。

```ts
.mock(userRepository, 'find', m => m.callsFake(async id =>
  id === 'u1' ? { id: 'u1' } : null
))
```

`fn` には対象メソッドと同じシグネチャの関数を渡す。
固定値を返すだけなら `m.returns()` / `m.resolves()` の方が意図が読み取りやすい。

`callsFake` を使った場合も呼び出しの記録は残るため、`e.mock()` での検証はそのまま使える。

## モックを検証する

### `e.mock(obj, key)`

```ts
mock<O, K extends RegKeyOrError<M, NoInfer<O>> & FnKeys<O>>(obj: O, key: K): MockAssertions<MethodOf<O, K>>
```

`.expect()` のコールバックが受け取る `e` から、登録済みのモックの呼ばれ方を調べる。
返るのは記述オブジェクトを作るためのマッチャ群で、次の 4 つがすべてである。

| マッチャ | 意味 |
|---|---|
| `calledTimes(n)` | ちょうど n 回呼ばれたこと |
| `notCalled()` | 一度も呼ばれていないこと |
| `calledWith(...args)` | その引数で呼ばれた回が1回以上あること |
| `calledOnceWith(...args)` | ちょうど1回、その引数で呼ばれたこと |

### `calledTimes(n)`

呼び出し回数がちょうど `n` 回であることを記述する。引数は見ない。

```ts
e.mock(mailService, 'send').calledTimes(1)
e.mock(userRepository, 'find').calledTimes(2)
```

「何回呼ばれたか」だけが関心事のときに使う。引数まで見たいなら `calledWith` 系を併用する。

### `notCalled()`

一度も呼ばれていないことを記述する。

```ts
e.mock(mailService, 'send').notCalled()
```

「失敗したらこの副作用は起きない」という性質を書くときに使う。
`calledTimes(0)` と同じ状況を指すが、意図が読み取りやすいので `notCalled()` を使う。

### `calledWith(...args)`

**その引数で呼ばれた回が1回以上ある**ことを記述する。

```ts
e.mock(userRepository, 'find').calledWith('u1')
```

`find` が `'u1'` と `'u2'` で合計 2 回呼ばれていても、`calledWith('u1')` は成立する。
他の引数での呼び出しがあってもよく、回数も問わない。

### `calledOnceWith(...args)`

**ちょうど1回、その引数で**呼ばれたことを記述する。

```ts
e.mock(mailService, 'send').calledOnceWith({ id: 'u1' })
```

`calledWith` との違いは回数の扱いにある。

| | 引数の一致 | 回数 |
|---|---|---|
| `calledWith(...args)` | その引数での呼び出しが 1 回以上 | 問わない |
| `calledOnceWith(...args)` | その引数での呼び出し | ちょうど 1 回 |

通知メールのように「二重送信が起きていないこと」まで含めて確かめたい副作用には `calledOnceWith` を使う。
呼ばれていれば十分な場合は `calledWith` で足りる。

### 引数の型

`calledWith` / `calledOnceWith` に渡す引数は、対象メソッドの `Parameters` に型が縛られる。

```ts
e.mock(mailService, 'send').calledOnceWith({ id: 'u1' })   // send(user: User) なので OK
e.mock(mailService, 'send').calledOnceWith({ id: 123 })    // 型エラー
e.mock(mailService, 'send').calledOnceWith('u1')           // 型エラー
```

引数の数と順序も検査される。

### 登録していないモックは型エラーになる

`e.mock()` の第2引数の制約は、**そのケースまでに `.mock()` で登録されたキー**から作られる。
登録していない `(obj, key)` を参照するとコンパイルエラーになる。

```ts
new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .it('...', t => t
    .args({ name: 'Alice' })
    .expect(e => [
      e.mock(userRepository, 'find').calledTimes(1),
      //                     ^^^^^^ 型エラー: find は登録していない
      e.mock(mailService, 'send').notCalled(),
      //     ^^^^^^^^^^^ 型エラー: mailService は一度も登録していない
    ]))
```

これは hanamaru の差別化軸の1つで、「モックし忘れたまま検証だけ書いた」という誤りを実行前に潰す。
仕組みと、この検出が効かない場合については [型推論](./type-inference.md) を参照。

## モックの適用と復元

モックは 1 ケースの実行手順の中で、決まった位置で適用され、決まった位置で戻される。

1. `.setup()` を実行してコンテキストを得る
2. **モックを適用する**（`Test` レベル → `it` レベルの順。同じ `(obj, key)` は後勝ち）
3. `.args()` / `.argsFrom()` で引数を決める
4. target を呼ぶ。戻り値が Promise なら await する
5. `.expect()` のアサーションを全部評価する
6. **`finally` でモックを元に戻し**、`.setup()` に後始末の関数を渡していればそれを呼ぶ

手順 6 は手順 4 や 5 が失敗しても必ず実行される。target が例外を投げても、アサーションが落ちても、
プロパティは元の値に戻る。**前のケースのモックが次のケースに漏れることはない。**

モックはケースごとに適用されるため、ケース間で呼び出し記録が混ざることもない。
`calledTimes(1)` はそのケースの中で 1 回という意味であり、ファイル全体での合計ではない。

実行順序の全体像は [実行セマンティクス](./semantics.md) を参照。

## モジュールモックは持たない

hanamaru が差し替えるのは**オブジェクトのプロパティ**だけである。
モジュール単位でモックする API は存在しない。

このページの例が動くのは、`createUser` が依存を `userRepository.save(...)` という
プロパティアクセスの形で呼んでいるからである。

```ts
export async function createUser(input: CreateUserInput): Promise<User> {
  const user = await userRepository.save(input)   // プロパティアクセスなので差し替えられる
  await mailService.send(user)
  return user
}
```

逆に、依存が import した関数として直接呼ばれている場合は差し替えられない。

```ts
import { save } from './repository.ts'

export async function createUser(input: CreateUserInput): Promise<User> {
  return await save(input)   // hanamaru では差し替えられない
}
```

この場合は、依存をオブジェクトのプロパティとして受け渡す形に変える必要がある。
**DI されていない依存はモックできない**、というのが hanamaru の制約である。

この割り切りの背景と、他に何ができないのかは [制約](./limitations.md) を参照。
