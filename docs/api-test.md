# Test ビルダー

`Test` は hanamaru のエントリポイントです。
`new Test()` はテストを実行せず、実行可能なデータ構造を組み立てて返します。
なぜこの形なのかは [設計思想](./concepts.md) を参照してください。

## 概観

```ts
import { Test } from 'hanamaru'

new Test()
  .target(fn)                              // 関数をテスト対象にする
  .target(obj, 'method')                   // オブジェクトのメソッドをテスト対象にする
  .describe(name)                          // 見出しの上書き（省略時は target 名から自動導出）
  .setup(() => ctx, ctx => cleanup(ctx))   // フィクスチャ。戻り値が後続に型付きで伝播。第2引数は後始末
  .mock(obj, 'method', m => behavior)      // 全ケース共通のモック
  .it(name, t => ...)                      // テストケース
  .only(name, t => ...)                    // このケースだけ実行
  .skip(name, t => ...)                    // スキップ
  .todo(name)                              // 未実装（コールバックなし）
```

このページで使う対象コードは次のものです。

```ts
// src/user.ts
export interface User { id: string }
export interface CreateUserInput { name: string }

export const userRepository = {
  async save(input: CreateUserInput): Promise<User> { /* ... */ },
  async find(id: string): Promise<User | null> { /* ... */ },
}

export const mailService = {
  async send(user: User): Promise<void> { /* ... */ },
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const user = await userRepository.save(input)
  await mailService.send(user)
  return user
}
```

## イミュータビリティ

**`Test` のすべてのメソッドはイミュータブルです。新しいビルダーを返し、元のビルダーは変化しません。**

これは hanamaru の中心的な性質であり、各メソッドの説明の前提になります。

```ts
const base = new Test().target(createUser)

const withRepo = base.mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))

// base は .mock() を持たないまま。withRepo だけがモックを持つ
```

### 再利用と派生

ビルダーが値なので、export して別のファイルから派生を作れます。

```ts
// src/user.test.ts
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

```ts
// src/user.db.test.ts
import { users } from './user.test.ts'

export const usersWithDb = users.setup(() => ({ db: makeTestDb() }))
```

`usersWithDb` は `users` のケースをすべて引き継ぎ、そこにフィクスチャを足した別のテストです。
`users` 側には何の影響もありません。両方 export されていれば、両方が実行されます。

### export しないと実行されない

CLI はテストファイルを `import()` し、**export されている値のうち `Test` インスタンス**を集めて実行します。
export されていない `Test` は実行されません。

```ts
// 実行される
export const users = new Test().target(createUser)./* ... */

// 実行されない
const draft = new Test().target(createUser)./* ... */
```

## `.target()`

テスト対象を決めます。ここで対象が確定することで、後続の `.args()` の引数型と
`e.result` の型が決まります。

### シグネチャ

```ts
target<G extends AnyFn>(fn: G): TestBuilder<G, M, C>
target<O, K extends FnKeys<O>>(obj: O, key: K): TestBuilder<MethodOf<O, K>, M, C>
```

### 2つの形

```ts
.target(createUser)              // 関数
.target(userService, 'create')   // オブジェクトのメソッド
```

**関数を渡す形**は、そのまま関数をテスト対象にします。

```ts
new Test()
  .target(createUser)
  .it('保存して通知する', t => t
    .args({ name: 'Alice' })
    .expect(e => [e.result.toEqual({ id: 'u1' })])
  )
```

**オブジェクトとメソッド名を渡す形**では、`this` が正しく束縛されます。
メソッドを取り出して単体で呼ぶと `this` が失われますが、この形ならその問題は起きません。

```ts
class UserService {
  label = 'user'
  async create(input: CreateUserInput): Promise<User> { /* this を使う */ }
}
const userService = new UserService()

new Test()
  .target(userService, 'create')
  .it('作成する', t => t
    .args({ name: 'Alice' })
    .expect(e => [e.result.toEqual({ id: 'u1' })])
  )
```

### 第2引数の制約

第2引数に渡せるのは、**関数型のプロパティのキーのみ**です。
非関数プロパティや存在しないキーは型エラーになります。

```ts
.target(userService, 'nope')    // 型エラー: 存在しないキー
.target(userService, 'label')   // 型エラー: 非関数プロパティ
```

この制約は `FnKeys<O>` によって表現されています。詳細は [型推論](./type-inference.md) を参照してください。

### target から決まるもの

`.target()` で確定した対象を `F` とすると、以降の型は次のように決まります。

| 決まるもの | 型 |
|---|---|
| `.args()` の引数 | `Parameters<F>` |
| `.argsFrom()` の戻り値 | `Parameters<F>`（タプル） |
| `e.result` | `Awaited<ReturnType<F>>` |

target の戻り値が Promise の場合、hanamaru は await してから `e.result` に渡します。
`.expect()` の中で await を書く必要はありません。

## `.describe()`

見出し（vitest の `describe` 相当）を上書きします。

### シグネチャ

```ts
describe(name: string): TestBuilder<F, M, C>
```

### 省略時の自動導出

`.describe()` は省略できます。省略した場合、見出しは `.target()` の内容から自動導出されます。

| target の書き方 | 導出される見出し |
|---|---|
| `.target(createUser)` | `createUser` |
| `.target(userService, 'create')` | `UserService.create` |

オブジェクトのメソッドを対象にした場合は、**コンストラクタ名 + メソッド名**になります。

### 上書きする

自動導出で十分でない場合に上書きします。

```ts
new Test()
  .target(createUser)
  .describe('ユーザー作成')
  .it('保存して通知する', t => t
    .args({ name: 'Alice' })
    .expect(e => [e.result.toEqual({ id: 'u1' })]))
```

## `.setup()`

フィクスチャを組み立てます。戻り値が後続の `.argsFrom()` と `.expect()` に
コンテキストとして型付きで渡ります。

### シグネチャ

```ts
setup<S>(fn: () => S, dispose?: (ctx: S) => void | Promise<void>): TestBuilder<F, M, S>
```

### 基本形

```ts
.setup(() => ({ db: makeTestDb() }))
```

これで `.argsFrom()` の引数と `e.ctx` の型が、`.setup()` の戻り値の型になります。

```ts
new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .mock(mailService, 'send', m => m.resolves(undefined))
  .setup(() => ({ input: { name: 'Alice' }, expected: { id: 'u1' } }))
  .it('保存して通知する', t => t
    .argsFrom(ctx => [ctx.input])
    .expect(e => [e.result.toEqual(e.ctx.expected)])
  )
```

### 後始末が必要な場合

第2引数に後始末の関数を渡します。

```ts
.setup(() => ({ db: makeTestDb() }), ctx => ctx.db.close())
```

第2引数の関数は、第1引数が返したコンテキストを**型付きで**受け取ります。
上の例で `ctx` の型は `{ db: TestDb }` になるので、`ctx.db.close()` は補完が効き、
存在しないメソッドを呼べば型エラーになります。

```ts
.setup(() => ({ db: makeTestDb() }), ctx => ctx.db.close2())
//                                              ^^^^^^ 型エラー: close2 は存在しない
```

戻り値は `void` でも `Promise<void>` でもかまいません。非同期の後始末はそのまま await されます。

```ts
.setup(() => ({ db: makeTestDb() }), async ctx => { await ctx.db.disconnect() })
```

この関数はケースの実行が終わったあとに呼ばれます。
target の呼び出しやアサーションの評価が失敗した場合でも、`finally` で必ず呼ばれます。
実行順序の詳細は [実行セマンティクス](./semantics.md) を参照してください。

### 各ケースごとに1回実行される

**`.setup()` は各テストケースごとに1回実行されます。ケース間で値は共有されません。**

```ts
new Test()
  .target(createUser)
  .setup(() => ({ db: makeTestDb() }))
  // 次の .it() で makeTestDb() が1回
  .it('ケース1', t => t
    .args({ name: 'Alice' })
    .expect(e => [e.result.toEqual({ id: 'u1' })]))
  // ここでもう1回。ケース1とは別の db になる
  .it('ケース2', t => t
    .args({ name: 'Bob' })
    .expect(e => [e.result.toEqual({ id: 'u1' })]))
```

ケース1で `db` に書き込んだ内容がケース2に見えることはありません。
逆に、重い初期化を1度だけ行って全ケースで共有する、という使い方はできません。

### 呼ばなかった場合

`.setup()` を呼ばなかった場合、コンテキストは `{}` になります。
存在しないプロパティへのアクセスは型エラーです。

```ts
new Test()
  .target(createUser)
  .it('...', t => t
    .args({ name: 'Alice' })
    .expect(e => [
      e.result.toSatisfy(() => e.ctx.db !== undefined),
      //                          ^^ 型エラー: e.ctx は {} なので db は存在しない
    ])
  )
```

## `.mock()`

依存オブジェクトのメソッドを差し替えます。ここで登録したモックは**全ケース共通**です。

### シグネチャ

```ts
mock<O, K extends FnKeys<O>>(
  obj: O,
  key: K,
  def: MockDef<O, K>
): TestBuilder<F, [...M, { obj: O; key: K }], C>
```

### 使い方

```ts
.mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
```

| 引数 | 意味 |
|---|---|
| `obj` | 差し替える対象のオブジェクト |
| `key` | 差し替えるメソッド名。関数型のプロパティのキーのみ |
| `def` | 振る舞いを返すコールバック |

第3引数のコールバックが返せる振る舞いは次の5つです。

| 記法 | 意味 |
|---|---|
| `m.returns(v)` | 同期的に `v` を返す |
| `m.resolves(v)` | `Promise.resolve(v)` を返す |
| `m.throws(e)` | 同期的に `e` を投げる |
| `m.rejects(e)` | `Promise.reject(e)` を返す |
| `m.callsFake(fn)` | `fn` を代わりに呼ぶ |

各振る舞いの詳細、型の縛られ方、使い分けは [モック](./api-mock.md) を参照してください。

### 登録が型に積み上がる

`.mock()` を呼ぶたびに、登録エントリが型パラメータ `M` にタプルとして積み上がります。

```text
TestBuilder<F, [], C>
  .mock(userRepository, 'save', ...)  →  TestBuilder<F, [{obj: UserRepository, key: 'save'}], C>
  .mock(mailService, 'send', ...)     →  TestBuilder<F, [{...}, {obj: MailService, key: 'send'}], C>
```

`e.mock(obj, key)` は、この `M` から登録済みのキーを引いて制約にします。
登録していないものを参照すると型エラーになります。

```ts
new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .it('...', t => t
    .args({ name: 'Alice' })
    .expect(e => [
      e.mock(userRepository, 'save').calledOnceWith({ name: 'Alice' }),  // OK
      e.mock(userRepository, 'find').calledTimes(1),   // 型エラー: 未登録キー
      e.mock(mailService, 'send').notCalled(),         // 型エラー: 未登録オブジェクト
    ])
  )
```

### `it` レベルのモックとの関係

`.it()` の中でも `.mock()` を呼べます。同じ `(obj, key)` に対する登録は**後勝ち**で、
`Test` レベルのモックを `it` レベルが上書きします。

```ts
new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .it('保存に失敗したら通知しない', t => t
    .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
    .args({ name: 'Alice' })
    .expect(e => [e.error.toBeInstanceOf(Error)])
  )
```

`it` レベルの追加は他のケースに漏れません。型の上でも漏れません。
詳細は [it ビルダー](./api-it.md) を参照してください。

### 制約

hanamaru のモックは**オブジェクトのメソッドの差し替え**だけです。
モジュールモック（vitest の `vi.mock` 相当）はありません。

差し替えたい依存は、テストから参照できるオブジェクトとして存在している必要があります。
この設計上の立場については [設計思想](./concepts.md) を参照してください。

## `.it()`

テストケースを追加します。

### シグネチャ

```ts
it(name: string, body: (t: ItBuilder<F, M, C>) => ItDone): TestBuilder<F, M, C>
```

### 使い方

```ts
.it('保存して通知する', t => t
  .args({ name: 'Alice' })
  .expect(e => [
    e.result.toEqual({ id: 'u1' }),
    e.mock(mailService, 'send').calledOnceWith({ id: 'u1' }),
  ])
)
```

| 引数 | 意味 |
|---|---|
| `name` | ケース名。レポータに出力され、`--filter` の対象になる |
| `body` | `t` を受け取り、`.expect()` まで到達した終端値を返すコールバック |

`body` は必ず `.expect()` を呼んで終端値を返す必要があります。
`.args()` を呼ばずに `.expect()` を呼ぶことはできません（型エラー）。

`t` の中で使えるメソッド（`.mock()` / `.args()` / `.argsFrom()` / `.expect()`）の仕様は
[it ビルダー](./api-it.md)、`e` のマッチャは [マッチャ](./api-expect.md) を参照してください。

### `M` を伸ばさずに返す

`.it()` は `M`（モック登録）を伸ばさずに `TestBuilder<F, M, C>` を返します。
つまり、`it` の中で追加したモックはそのケースのスコープに閉じ、次の `.it()` には見えません。

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

## `.only()`

そのケースだけを実行します。

### シグネチャ

```ts
only(name: string, body: (t: ItBuilder<F, M, C>) => ItDone): TestBuilder<F, M, C>
```

### 挙動

`.it()` と書き方は同じですが、実行対象の絞り込みが起きます。

**どこか1箇所でも `.only()` があれば、全ファイル横断で only のついたケースだけが実行されます。**
他のケースは skip として報告されます。

```ts
export const users = new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .only('保存して通知する', t => t
    .args({ name: 'Alice' })
    .expect(e => [e.result.toEqual({ id: 'u1' })])
  )
  // only があるため、このケースは skip として報告されます
  .it('保存に失敗したら通知しない', t => t
    .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
    .args({ name: 'Alice' })
    .expect(e => [e.error.toBeInstanceOf(Error)]))
```

この絞り込みは、このファイルの中だけの話ではありません。
別のファイルにある `.it()` も同じように skip されます。
`.only()` を消し忘れたまま CI を回すと、ほとんどのテストが skip された状態で
終了コード 0 になります。

特定のケースだけを名前で絞り込みたい場合は、コードを変えずに CLI の `--filter` を使えます。
[CLI](./cli.md) を参照してください。

## `.skip()`

そのケースを実行せず、skip として報告します。

### シグネチャ

```ts
skip(name: string, body: (t: ItBuilder<F, M, C>) => ItDone): TestBuilder<F, M, C>
```

### 挙動

コールバックの中身はそのまま残りますが、そのケースは実行されません。

```ts
.skip('まだ直っていない', t => t
  .args({ name: 'Alice' })
  .expect(e => [e.result.toEqual({ id: 'u1' })])
)
```

skip だけで構成されたテストは失敗ではありません。終了コードは 0 になります。

## `.todo()`

未実装のケースを記録します。コールバックを取りません。

### シグネチャ

```ts
todo(name: string): TestBuilder<F, M, C>
```

### 挙動

```ts
.todo('メール送信に失敗したときの扱いを決める')
```

名前だけを登録し、todo として報告します。
`.skip()` と違い、本体を書く必要がありません。書くことが決まっていない段階で使います。

todo だけの場合も終了コードは 0 です。

## 型で防げること

`Test` ビルダーに関係するもののうち、コンパイル時に検出できる誤りは次のとおりです。

| 誤り | 結果 |
|---|---|
| `.target(userService, 'nope')`（存在しないキー） | 型エラー |
| `.target(userService, 'label')`（非関数プロパティ） | 型エラー |
| `m.resolves({ nope: 1 })`（モック戻り値型違い） | 型エラー |
| `e.mock(userRepository, 'find')`（未登録キー） | 型エラー |
| `e.mock(mailService, 'send')`（未登録オブジェクト） | 型エラー |
| `.setup()` なしで `e.ctx.db` | 型エラー |

`it` の中で防げるもの（`.args()` の typo、`.args()` を呼ばずに `.expect()` など）は
[it ビルダー](./api-it.md)、型システムの限界は [型推論](./type-inference.md) を参照してください。

なお、hanamaru は型チェックを一切行いません。テストを実行するだけです。
型エラーは `tsc --noEmit` で別途検出してください。

## 関連ドキュメント

- [it ビルダー](./api-it.md) — `.it()` の中で使う `.args()` / `.argsFrom()` / `.expect()`
- [モック](./api-mock.md) — `m.returns` / `m.resolves` / `m.throws` / `m.rejects` / `m.callsFake`
- [マッチャ](./api-expect.md) — `e.result` / `e.error` / `e.ctx` / `e.mock()`
- [型推論](./type-inference.md) — 型パラメータの仕組みと限界
- [実行セマンティクス](./semantics.md) — 1ケースの実行順序、only の扱い、終了コード
- [設計思想](./concepts.md) — なぜこの形なのか
