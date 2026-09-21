# 型推論

hanamaru の型は、チェーンに沿って一段ずつ積み上がる。`.target()` がテスト対象の関数型を決め、`.setup()` がコンテキスト型を決め、`.mock()` が登録済みモックの一覧を型パラメータに積み上げ、最後の `.expect()` がそれらをすべて受け取って参照可能なものを決める。

このドキュメントは、その積み上がり方を型定義のレベルで説明する。API の使い方そのものは [test ビルダー](./api-test.md) / [it ビルダー](./api-it.md) / [mock](./api-mock.md) / [expect](./api-expect.md) を参照。

## target からの推論

`.target()` はビルダーの型パラメータ `F`（テスト対象の関数型）を決める。`F` が決まると、そこから 2 つが自動的に決まる。

| 決まるもの | 由来 |
|---|---|
| `.args()` に渡せる引数 | `Parameters<F>` |
| `e.result` のマッチャが受け取る値の型 | `Awaited<ReturnType<F>>` |

### 関数を渡す形

```ts
import { Test } from 'hanamaru'
import { createUser } from './user.ts'

// createUser: (input: CreateUserInput) => Promise<User>

new Test()
  .target(createUser)
  // F = (input: CreateUserInput) => Promise<User>
  // Parameters<F>              = [CreateUserInput]
  // Awaited<ReturnType<F>>     = User
```

これにより `.args({ name: 'Alice' })` は通り、`.args({ nam: 'Alice' })` や `.args(123)` は型エラーになる。`e.result.toEqual(...)` に渡せるのは `User` であり、`{ id: 123 }` は型エラーになる。

### Awaited は同期関数にも一律にかかる

戻り値の型は常に `Awaited<ReturnType<F>>` で計算される。`Awaited<T>` は `T` が `Promise` でなければ `T` をそのまま返すため、同期関数でも戻り値の型は変わらない。

```ts
declare function sum(a: number, b: number): number

new Test()
  .target(sum)
  // Awaited<ReturnType<typeof sum>> = Awaited<number> = number
  .it('足し算', t => t
    .args(1, 2)
    .expect(e => [e.result.toBe(3)]))
```

つまり「非同期なら await 済みの型、同期ならそのままの型」が一つの式で表現されている。テストを書く側は target が同期か非同期かを意識せず、`e.result` を値として扱える。これは実行セマンティクス（Promise なら await してからアサーションを評価する）と対応している。詳細は [実行セマンティクス](./semantics.md) を参照。

### オブジェクトとメソッド名を渡す形

`.target(obj, 'method')` でも推論結果は同じ `F` である。

```ts
declare const userService: {
  create(input: CreateUserInput): Promise<User>
  label: string
}

new Test()
  .target(userService, 'create')
  // F = (input: CreateUserInput) => Promise<User>
```

この形は 2 つの型で支えられている。

```ts
/** O のうち関数型のプロパティキーだけを抜き出す */
export type FnKeys<O> = {
  [K in keyof O]-?: NonNullable<O[K]> extends AnyFn ? K : never
}[keyof O]

export type MethodOf<O, K> = K extends keyof O
  ? NonNullable<O[K]> extends AnyFn ? NonNullable<O[K]> : never
  : never
```

`FnKeys<O>` は `O` のキーを走査し、値が関数型であるキーだけを残して union にする。`-?` でオプショナル修飾子を外し、`NonNullable` で `undefined` を剥がしてから関数型かどうかを判定しているため、`method?: () => void` のような省略可能なメソッドもキーとして拾われる。

第 2 引数の型は `K extends FnKeys<O>` に縛られる。したがって次の 2 つはどちらも型エラーになる。

```ts
new Test().target(userService, 'nope')   // 型エラー: 存在しないキー
new Test().target(userService, 'label')  // 型エラー: 非関数プロパティ（string）
```

`MethodOf<O, K>` は、通ったキーから実際の関数型を取り出してビルダーの `F` に据える役割を持つ。`.target(userService, 'create')` の後は、関数を直接渡した場合とまったく同じように `Parameters` と `Awaited<ReturnType>` が効く。

## setup のコンテキスト伝播

`.setup()` はビルダーの型パラメータ `C`（コンテキスト型）を置き換える。

```ts
setup<S>(fn: () => S): TestBuilder<F, M, S>
```

`S` は `fn` の戻り値型から推論され、そのまま `C` になる。`C` が現れるのは 2 箇所である。

| 場所 | 型 |
|---|---|
| `.argsFrom(build)` の `build` の引数 | `C` |
| `e.ctx` | `C` |

```ts
declare function makeTestDb(): { savedIds(): string[] }

new Test()
  .target(createUser)
  .setup(() => ({ db: makeTestDb(), name: 'Alice' }))
  // C = { db: { savedIds(): string[] }, name: string }
  .it('コンテキストから引数を組み立てる', t => t
    .argsFrom(ctx => [{ name: ctx.name }])
    //                      ^ ctx は C として型付けされる
    .expect(e => [
      e.result.toEqual({ id: 'u1' }),
      e.result.toSatisfy(user => e.ctx.db.savedIds().includes(user.id)),
      //                              ^ e.ctx も同じ型。マッチャではなく値そのもの
    ]))
```

`.argsFrom()` のコールバックは引数をタプルで返す。返り値の型は `Parameters<F>` に縛られるため、`ctx` から組み立てた引数も target のシグネチャと突き合わされる。

### setup を呼ばなかった場合

`C` の初期値は `{}` である。つまり `.setup()` を呼ばずに `e.ctx` のプロパティへアクセスすると型エラーになる。

```ts
new Test()
  .target(createUser)
  // C = {}
  .it('setup なし', t => t
    .args({ name: 'Alice' })
    .expect(e => [
      e.result.toSatisfy(user => e.ctx.db.savedIds().includes(user.id)),
      //                               ^^ 型エラー: Property 'db' does not exist on type '{}'
    ]))
```

「コンテキストを用意していないのに参照した」という間違いが、実行前に検出される。

## mock 登録の積み上げ

hanamaru の型の中核はここにある。`.mock()` を呼ぶたびに、登録エントリが型パラメータ `M` にタプルとして積み上がる。

### タプルが伸びる

```text
TestBuilder<F, [], C>
  .mock(userRepository, 'save', ...)  →  TestBuilder<F, [{obj: UserRepository, key: 'save'}], C>
  .mock(mailService, 'send', ...)     →  TestBuilder<F, [{...}, {obj: MailService, key: 'send'}], C>
```

対応する宣言は次の形をしている。戻り値の `[...M, { obj: O; key: K }]` が「今までの登録 + 今回の登録」であり、これがタプルを 1 要素伸ばす。

```ts
mock<O, K extends FnKeys<O>>(obj: O, key: K, def: MockDef<O, K>): TestBuilder<F, [...M, { obj: O; key: K }], C>
```

`key` の型は `K extends FnKeys<O>` に縛られるので、ここでも関数型のプロパティしか登録できない。`def` は「振る舞い」を返すコールバックで、`m.returns()` の引数は対象メソッドの `ReturnType` に、`m.resolves()` の引数は `Awaited<ReturnType>` に縛られる。

### e.mock はタプルから引く

`.expect()` の中の `e.mock(obj, 'method')` は、この `M` から「その `obj` に対して登録済みのキー」を引き、それを第 2 引数の制約にする。

```ts
/** 特定の obj に対して登録済みのキーの union */
export type RegKey<M extends readonly MockEntry[], O> = Extract<M[number], { obj: O }>['key']
```

`M[number]` でタプルを要素の union に開き、`Extract<..., { obj: O }>` でその `obj` に一致するエントリだけを残し、`['key']` でキーを取り出す。登録が `save` だけなら `RegKey` は `'save'` になり、`e.mock(userRepository, 'find')` は制約を満たさず型エラーになる。

登録が 1 件も無いときは `RegKey` が `never` になる。`never` をそのまま制約に使うと、tsc のメッセージが `not assignable to type 'never'` になって理由が伝わらない。そこでブランド型に差し替える。

```ts
export interface NotRegistered<Msg extends string, O> {
  readonly __hanamaru_error: Msg
  readonly __obj: O
}

export type RegKeyOrError<M extends readonly MockEntry[], O> = [RegKey<M, O>] extends [never]
  ? NotRegistered<'no mock was registered for this object via .mock()', O>
  : RegKey<M, O>
```

`[T] extends [never]` とタプルで包んでいるのは、裸の `never` に対する条件型の分配を止めるためである。これにより「登録が 1 件も無い」という状況だけを正確に捉えられる。エラーメッセージには `no mock was registered for this object via .mock()` という文字列が型名として現れる。

### NoInfer が必要な理由

`e.mock()` の宣言はこうなっている。

```ts
mock<O, K extends RegKeyOrError<M, NoInfer<O>> & FnKeys<O>>(
  obj: O, key: K
): MockAssertions<MethodOf<O, K>>
```

`O` は第 1 引数から推論される。しかし `K` の制約の中でも `O` を参照しているため、`NoInfer` が無いと推論が循環して壊れる。`NoInfer<O>` と書くことで「ここは推論元にしない」と指示でき、`O` が第 1 引数から先に確定してから `K` の制約が解決される。

`NoInfer` は TypeScript 5.4 で追加された組み込み型である。hanamaru が TypeScript 5.4 以上を要求するのはこのためだけである。

`K` の制約が `RegKeyOrError<M, NoInfer<O>> & FnKeys<O>` という交差になっているのは、キーが「登録済みであること」と「その `obj` の関数型プロパティであること」の両方を満たす必要があるからである。戻り値の `MockAssertions<MethodOf<O, K>>` によって、`calledWith` / `calledOnceWith` の引数が対象メソッドの `Parameters` に縛られる。

### 型定義の全体

ここまでの断片を含む、検証済みの型定義の全体を示す。これが仕様そのものである。

```ts
export type AnyFn = (...args: any[]) => any

declare const assertionBrand: unique symbol
export interface Assertion { readonly [assertionBrand]: 'assertion' }

/** O のうち関数型のプロパティキーだけを抜き出す */
export type FnKeys<O> = {
  [K in keyof O]-?: NonNullable<O[K]> extends AnyFn ? K : never
}[keyof O]

export type MethodOf<O, K> = K extends keyof O
  ? NonNullable<O[K]> extends AnyFn ? NonNullable<O[K]> : never
  : never

/** 型パラメータに積み上げるモック登録エントリ */
export type MockEntry = { obj: unknown; key: PropertyKey }

/** 特定の obj に対して登録済みのキーの union */
export type RegKey<M extends readonly MockEntry[], O> = Extract<M[number], { obj: O }>['key']

export interface NotRegistered<Msg extends string, O> {
  readonly __hanamaru_error: Msg
  readonly __obj: O
}

/**
 * 登録が1件も無いとき never ではなくブランド型を返す。
 * never のままだと tsc のメッセージが "not assignable to type 'never'" になり理由が伝わらない。
 */
export type RegKeyOrError<M extends readonly MockEntry[], O> = [RegKey<M, O>] extends [never]
  ? NotRegistered<'no mock was registered for this object via .mock()', O>
  : RegKey<M, O>

export interface Expect<F extends AnyFn, M extends readonly MockEntry[], C> {
  readonly result: ValueAssertions<Awaited<ReturnType<F>>>
  readonly error: ErrorAssertions
  readonly ctx: C
  /** NoInfer で O を先に確定させてから K の制約を解決する */
  mock<O, K extends RegKeyOrError<M, NoInfer<O>> & FnKeys<O>>(
    obj: O, key: K
  ): MockAssertions<MethodOf<O, K>>
}

export interface ItBuilder<F extends AnyFn, M extends readonly MockEntry[], C> {
  mock<O, K extends FnKeys<O>>(obj: O, key: K, def: MockDef<O, K>): ItBuilder<F, [...M, { obj: O; key: K }], C>
  args(...a: Parameters<F>): ItArgs<F, M, C>
  argsFrom(build: (c: C) => Parameters<F>): ItArgs<F, M, C>
}

export interface ItArgs<F extends AnyFn, M extends readonly MockEntry[], C> {
  mock<O, K extends FnKeys<O>>(obj: O, key: K, def: MockDef<O, K>): ItArgs<F, [...M, { obj: O; key: K }], C>
  expect(build: (e: Expect<F, M, C>) => Assertion[]): ItDone
}

export interface TestBuilder<F extends AnyFn, M extends readonly MockEntry[], C> {
  target<G extends AnyFn>(fn: G): TestBuilder<G, M, C>
  target<O, K extends FnKeys<O>>(obj: O, key: K): TestBuilder<MethodOf<O, K>, M, C>
  mock<O, K extends FnKeys<O>>(obj: O, key: K, def: MockDef<O, K>): TestBuilder<F, [...M, { obj: O; key: K }], C>
  setup<S>(fn: () => S): TestBuilder<F, M, S>
  it(name: string, body: (t: ItBuilder<F, M, C>) => ItDone): TestBuilder<F, M, C>
}
```

3 つのビルダーインターフェースを並べて読むと、チェーンの順序制約が型の形そのものから出ていることが分かる。

- `ItBuilder` には `expect` が無い。よって `.args()` / `.argsFrom()` を呼ぶ前に `.expect()` を書くことはできない
- `ItArgs` には `args` / `argsFrom` が無い。よって `.args()` と `.argsFrom()` の併用も、`.args()` の二度呼びも構造的に起こらない
- `ItBuilder` と `ItArgs` の両方が `mock` を持つ。よって `.mock()` は `.args()` の前でも後でも書ける
- `expect` の戻り値は `ItDone` であり、メソッドを持たない終端型である。よって `.expect()` の後に何かを続けることはできない

`Assertion` が `unique symbol` でブランドされているのも意図的である。`.expect()` のコールバックの戻り値型は `Assertion[]` なので、`[true]` のような素の値を返すと型エラーになる。`e.mock(userRepository, 'save')` のようにマッチャを呼び忘れた場合も、戻り値は `MockAssertions<...>` であって `Assertion` ではないため型エラーになる。

## it レベルのモックのスコープ

`.it()` の中で追加した `.mock()` は、そのケースの型にだけ反映される。他のケースには漏れない。

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

理由は `it` の宣言にある。

```ts
it(name: string, body: (t: ItBuilder<F, M, C>) => ItDone): TestBuilder<F, M, C>
```

`body` には現時点の `M` を持った `ItBuilder` が渡されるが、`it` 自身が返すのは `TestBuilder<F, M, C>` であり `M` は伸びていない。`body` の中で `M` がどれだけ伸びても、その結果は `ItDone` に吸収されて外へ出ない。ケースごとのモック登録が型レベルで閉じるのはこのためである。

これは実行時の挙動（`it` レベルのモックはそのケースの実行中だけ適用され、`finally` で必ず復元される）と一致している。型と実行が同じ境界を持っているので、片方だけを覚える必要がない。

## 型で防げること

以下はすべて検証済みである。

| 誤り | 結果 |
|---|---|
| `.args({ nam: 'Alice' })`（typo） | 型エラー |
| `.args(123)`（型違い） | 型エラー |
| `.target(userService, 'nope')`（存在しないキー） | 型エラー |
| `.target(userService, 'label')`（非関数プロパティ） | 型エラー |
| `e.result.toEqual({ id: 123 })`（戻り値型違い） | 型エラー |
| `e.result.toMatchObject({ ids: 'u1' })`（存在しないキー） | 型エラー |
| `m.resolves({ nope: 1 })`（モック戻り値型違い） | 型エラー |
| `e.mock(userRepository, 'find')`（未登録キー） | 型エラー |
| `e.mock(mailService, 'send')`（未登録オブジェクト） | 型エラー |
| `.expect(e => [true])`（Assertion でない値） | 型エラー |
| `.expect(e => [e.mock(repo, 'save')])`（マッチャ呼び忘れ） | 型エラー |
| `.args()` を呼ばずに `.expect()` | 型エラー |
| `.setup()` なしで `e.ctx.db` | 型エラー |

引数と戻り値に関する 4 つは `Parameters<F>` と `Awaited<ReturnType<F>>` から出る。

```ts
.it('引数の typo', t => t
  .args({ nam: 'Alice' })                        // 型エラー: CreateUserInput に nam は無い
  .expect(e => [e.result.toEqual({ id: 'u1' })]))

.it('引数の型違い', t => t
  .args(123)                                     // 型エラー: CreateUserInput でない
  .expect(e => [e.result.toEqual({ id: 'u1' })]))

.it('戻り値の型違い', t => t
  .args({ name: 'Alice' })
  .expect(e => [
    e.result.toEqual({ id: 123 }),               // 型エラー: id は string
    e.result.toMatchObject({ ids: 'u1' }),       // 型エラー: 存在しないキー
  ]))
```

モック登録に関する 3 つは `FnKeys` と `RegKeyOrError` から出る。

```ts
// 振る舞いの戻り値型
new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ nope: 1 }))
  //                                             ^^^^^^^ 型エラー: User でない

// 未登録キー / 未登録オブジェクトの参照
new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .it('未登録の参照', t => t
    .args({ name: 'Alice' })
    .expect(e => [
      e.mock(userRepository, 'find').calledTimes(1),  // 型エラー: find は未登録
      e.mock(mailService, 'send').notCalled(),        // 型エラー: mailService は未登録
    ]))
```

`.expect()` の戻り値に関する 2 つは `Assertion` のブランドから出る。

```ts
.expect(e => [
  true,                                // 型エラー: Assertion でない
  e.mock(userRepository, 'save'),      // 型エラー: マッチャを呼んでいない
])
```

## 型の限界

隠さずに書く。型で捕まえられない誤りが 1 つ、型で捕まえたあとの表示に関する既知の粗さが 1 つある。

### 構造的に同一な別オブジェクトは区別できない

TypeScript は構造的型システムなので、同じ形の 2 つのオブジェクトは同じ型になる。オブジェクト参照そのものを型レベルのキーにすることは原理的に不可能である。

```ts
declare const userRepository: { save(u: User): Promise<User> }
declare const shadowRepository: { save(u: User): Promise<User> }  // 同一構造

new Test()
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .it('...', t => t.args({ name: 'a' }).expect(e => [
    e.mock(shadowRepository, 'save').calledTimes(1),   // 型エラーにならない
  ]))
```

`RegKey<M, O>` は `Extract<M[number], { obj: O }>` で `obj` の型を突き合わせるが、`shadowRepository` の型は `userRepository` の型と構造的に等しいため、登録済みと判定されてしまう。

実行時には参照の同一性で正しく区別されるため、このケースは実行時に「登録されていないモックを参照しています」というエラーになる。型では通り、実行で落ちる。

`private` フィールドを持つ class や `unique symbol` によるブランド型を使うと区別できるようになる（検証済み）。ただしボイラープレートが増えるため、hanamaru はこれを要求しない。これは Hono が context variable について受け入れているのと同種の意図的な割り切りである。

### 型エラーメッセージが粗い

未登録オブジェクトを参照したときのエラーは、次の形で出る。

```console
Property 'calledTimes' does not exist on type 'NotRegistered<"no mock was registered for this object via .mock()", ...>'
```

`NotRegistered` の型引数に理由の文字列が載るので原因は伝わる。ただし 2 つの注意点がある。

1. エラーが指す位置がマッチャ名（`calledTimes`）であり、実際に間違えた `e.mock()` の引数から数十文字ずれる
2. オブジェクトが `interface` ではなく匿名型（`const repo = { ... }`）の場合、TypeScript の型表示長制限（160 文字）で型が途中で打ち切られ、読みにくくなる

どちらも既知の粗さである。エラー行の先頭ではなく `e.mock()` の第 1・第 2 引数を疑うこと。

## 検証済みであることについて

ここに書かれた型定義と挙動は、TypeScript 5.9.3 と 7.0.2 の両方で実際にコンパイルを通して検証されている。「型で防げること」の表の各行は、コンパイルエラーになることを確認したものである。

必要な TypeScript のバージョンは **5.4 以上**であり、理由は `NoInfer` の 1 点に尽きる。これより古いバージョンでは `e.mock()` の推論が成立しない。

なお hanamaru のランナーは型チェックを一切行わない。型エラーの検出は `tsc --noEmit` を別途実行すること。動作要件とその他の制約は [制約](./limitations.md) を参照。
