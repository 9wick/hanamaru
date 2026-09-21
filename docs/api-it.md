# it の中のビルダー

`.it()` に渡すコールバックは、1件のテストケースを組み立てるビルダー `t` を受け取る。
このページでは `t` に生えている 4 つのメソッド `.mock()` / `.args()` / `.argsFrom()` / `.expect()` を説明する。

`.it()` / `.only()` / `.skip()` / `.todo()` そのものの説明は [Test ビルダー](./api-test.md) を参照。

## チェーンの全体像

```ts
.it('保存して通知する', t => t
  .mock(obj, 'method', m => behavior)   // このケースだけ追加・上書き
  .args(...引数)                         // 引数を直接渡す
  .argsFrom(ctx => [...引数])            // setup のコンテキストから組み立てる
  .expect(e => [ ...アサーション ])       // アサーションの「記述」を配列で返す
)
```

コールバックは `.expect()` の戻り値をそのまま返す必要がある。`.expect()` が返す終端型が `.it()` の
シグネチャで要求されているため、`.expect()` を呼ばずにコールバックを終えると型エラーになる。

`createUser` の例で書くと次のようになる。

```ts
import { Test } from 'hanamaru'
import { createUser, userRepository, mailService } from './user.ts'

export const users = new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .mock(mailService, 'send', m => m.resolves(undefined))
  .it('保存して通知する', t => t
    .args({ name: 'Alice' })
    .expect(e => [
      e.result.toEqual({ id: 'u1' }),
      e.mock(mailService, 'send').calledOnceWith({ id: 'u1' }),
    ])
  )
```

## `.mock()`

このケースだけに効くモックを追加する。あるいは `Test` レベルで宣言済みのモックを上書きする。

### シグネチャ

```ts
mock<O, K extends FnKeys<O>>(obj: O, key: K, def: MockDef<O, K>): ItBuilder<F, [...M, { obj: O; key: K }], C>
```

`.args()` を呼んだ後も同じ形のメソッドが生えている。

```ts
mock<O, K extends FnKeys<O>>(obj: O, key: K, def: MockDef<O, K>): ItArgs<F, [...M, { obj: O; key: K }], C>
```

第2引数に渡せるのは `obj` の**関数型のプロパティのキーのみ**。第3引数のコールバックが返せる振る舞いは
`m.returns()` / `m.resolves()` / `m.throws()` / `m.rejects()` / `m.callsFake()` の 5 つで、
それぞれの意味と型の縛りは [モック](./api-mock.md) にまとめてある。

### 位置は自由

`.mock()` は `.args()` の前でも後でも書ける。どちらも同じ結果になる。

```ts
// 前に書く
.it('保存に失敗したら通知しない', t => t
  .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
  .args({ name: 'Alice' })
  .expect(e => [
    e.error.toBeInstanceOf(Error),
    e.mock(mailService, 'send').notCalled(),
  ])
)

// 後に書く（同じ意味）
.it('保存に失敗したら通知しない', t => t
  .args({ name: 'Alice' })
  .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
  .expect(e => [
    e.error.toBeInstanceOf(Error),
    e.mock(mailService, 'send').notCalled(),
  ])
)
```

`.args()` の前の `t` と後の `t` は別の型だが、どちらにも `.mock()` が同じシグネチャで生えているため、
好きな順で書ける。「引数を先に読みたいか、前提を先に読みたいか」で選んでよい。

### Test レベルのモックを上書きする

モックは `Test` レベル → `it` レベルの順に適用され、同じ `(obj, key)` の組は**後勝ち**になる。
つまり `it` レベルの `.mock()` が `Test` レベルの宣言を上書きする。

```ts
new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))   // 既定の振る舞い
  .mock(mailService, 'send', m => m.resolves(undefined))
  .it('保存に失敗したら通知しない', t => t
    .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))  // このケースだけ上書き
    .args({ name: 'Alice' })
    .expect(e => [
      e.error.toBeInstanceOf(Error),
      e.mock(mailService, 'send').notCalled(),
    ])
  )
```

`mailService.send` は上書きしていないので、`Test` レベルの宣言がそのまま効く。
適用と復元の詳細な順序は [実行セマンティクス](./semantics.md) を参照。

### 他のケースには漏れない

`it` レベルで追加したモックは、**そのケースの中だけ**に存在する。型の上でも他のケースからは見えない。

```ts
new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .it('it 内で追加', t => t
    .mock(mailService, 'send', m => m.rejects(new Error('smtp')))
    .args({ name: 'a' })
    .expect(e => [
      e.mock(mailService, 'send').calledOnceWith({ id: 'u1' }),   // OK
    ]))
  .it('他の it には漏れない', t => t
    .args({ name: 'b' })
    .expect(e => [
      e.mock(mailService, 'send').calledTimes(1),
      //       ^^^^^^^^^^^ 型エラー: 前のケースで追加したモックは見えない
    ]))
```

2つ目のケースでは `mailService.send` を登録していないため、`e.mock(mailService, 'send')` は型エラーになる。
`.it()` がモック登録のリストを伸ばさずに元のビルダーを返すため、スコープが正しく閉じる。
この仕組みの詳細は [型推論](./type-inference.md) を参照。

実行時も同様で、モックはケースごとに適用され `finally` で必ず元に戻される。前のケースのモックが次のケースに漏れることはない。

## `.args()`

target に渡す引数を直接書く。

```ts
args(...a: Parameters<F>): ItArgs<F, M, C>
```

可変長引数として target のシグネチャそのものを受け取るため、引数の数・順序・型がすべて検査される。

```ts
.args({ name: 'Alice' })          // createUser(input: CreateUserInput) に対応
```

型エラーになる例。

```ts
.args({ nam: 'Alice' })   // 型エラー: キーの typo
.args(123)                // 型エラー: 型違い
```

## `.argsFrom()`

`.setup()` が組み立てたコンテキストから引数を作る。

```ts
argsFrom(build: (c: C) => Parameters<F>): ItArgs<F, M, C>
```

コールバックは**引数をタプルで返す**。可変長引数に対応するためで、引数が1つのときも配列で包む。

```ts
new Test()
  .target(createUser)
  .setup(() => ({ input: { name: 'Alice' } }))
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .mock(mailService, 'send', m => m.resolves(undefined))
  .it('setup の値を引数にする', t => t
    .argsFrom(ctx => [ctx.input])
    .expect(e => [
      e.result.toEqual({ id: 'u1' }),
    ])
  )
```

コールバックの引数 `c` の型は `.setup()` の戻り値そのもの。`.setup()` を呼んでいなければ `{}` になるため、
そこからプロパティを取り出そうとすると型エラーになる。

## なぜ `.args()` と `.argsFrom()` が分かれているのか

1つのメソッドで両方を兼ねると、target の第1引数が関数型のときに意味が決まらなくなるため。

```ts
declare function withCallback(cb: () => void): void

new Test()
  .target(withCallback)
  .it('...', t => t
    .args(() => {})   // この関数は何か
    ...
```

この `() => {}` は 2 通りに読める。

1. `withCallback` の引数として渡したい関数そのもの
2. コンテキストを受け取って引数を組み立てる関数

どちらも「関数」であり、型だけで区別することはできない。引数の個数や戻り値で判別しようとしても、
`() => void` を組み立て関数と誤認する組み合わせは作れてしまう。

hanamaru はメソッドを 2 つに分けることでこの曖昧性を消している。

```ts
.args(() => {})            // 引数としての関数を渡す
.argsFrom(ctx => [ctx.cb]) // コンテキストから引数を組み立てる
```

`.argsFrom()` の戻り値がタプルであることも、この区別を補強している。
`.args()` は「引数をそのまま並べる」、`.argsFrom()` は「引数の並びを値として作る」であり、
読んだだけでどちらなのかが分かる。

## `.expect()`

アサーションの記述を配列で返す。

```ts
expect(build: (e: Expect<F, M, C>) => Assertion[]): ItDone
```

コールバックが受け取る `e` には `result` / `error` / `ctx` / `mock()` が生えている。

```ts
.expect(e => [
  e.result.toEqual({ id: 'u1' }),
  e.mock(mailService, 'send').calledOnceWith({ id: 'u1' }),
])
```

重要なのは、**マッチャは呼ばれた時点では何も検証しない**ということ。
`e.result.toEqual({ id: 'u1' })` は「戻り値が `{ id: 'u1' }` と深く等しいこと」という記述オブジェクトを
返すだけで、その場では比較も失敗もしない。配列で返されたものをフレームワークが受け取り、
target を呼んだ後にまとめて評価する。

そのため、`.expect()` のコールバックの中に `if` や `for` を書いて手続きを組み立てる必要はない。
アサーションは値であり、配列に並べるものである。

マッチャの一覧と意味は [アサーション](./api-expect.md) を参照。
`e.mock()` のマッチャは [モック](./api-mock.md) にまとめてある。

## チェーンの順序制約

### `.args()` / `.argsFrom()` はどちらか一方を必ず呼ぶ

2つは排他で、どちらか一方を必ず呼ぶ。

`.args()` も `.argsFrom()` も `ItArgs` 型を返し、`.expect()` は `ItArgs` にしか生えていない。
したがって、引数を決めずに `.expect()` を呼ぶことは構造的にできない。

```ts
.it('...', t => t
  .expect(e => [e.result.toEqual({ id: 'u1' })])
  // 型エラー: .args() / .argsFrom() を呼ぶ前の t に .expect() は存在しない
)
```

### `.expect()` は終端

`.expect()` は `ItDone` を返す。この型にはメソッドが生えていない。

```ts
.it('...', t => t
  .args({ name: 'Alice' })
  .expect(e => [e.result.toEqual({ id: 'u1' })])
  .mock(mailService, 'send', m => m.resolves(undefined))
  // 型エラー: .expect() の後に .mock() は存在しない
)
```

「アサーションを書いた後にモックを足す」という順序違反が起きないため、
読む側は「`.expect()` が出てきたらそのケースの前提は出揃っている」と考えてよい。

## 型エラーになるケース一覧

| 書いたもの | 結果 |
|---|---|
| `.args({ nam: 'Alice' })`（typo） | 型エラー |
| `.args(123)`（型違い） | 型エラー |
| `.args()` を呼ばずに `.expect()` | 型エラー |
| `.expect()` の後に `.mock()` | 型エラー |
| `.setup()` なしで `.argsFrom(ctx => [ctx.input])` | 型エラー |
| 登録していないモックを `e.mock()` で参照 | 型エラー |
| `.expect(e => [true])`（`Assertion` でない値） | 型エラー |
| `.expect(e => [e.mock(userRepository, 'save')])`（マッチャ呼び忘れ） | 型エラー |

それぞれがなぜ型エラーになるのかは [型推論](./type-inference.md) にまとめてある。

なお hanamaru 自身は型チェックを行わない。上記はすべて `tsc --noEmit` で検出するものであり、
実行時に検出されるわけではない。詳細は [制約](./limitations.md) を参照。
