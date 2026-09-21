# はじめる

インストールから、最初の1テストが通るまでを通しでたどる。題材は `createUser` という「保存して通知する」関数とする。

## インストール

npm。

```console
$ npm i -D hanamaru
```

pnpm。

```console
$ pnpm add -D hanamaru
```

Bun。

```console
$ bun add -d hanamaru
```

実行時依存パッケージは 0 なので、インストールされるのは hanamaru 自身だけになる。

## 動作要件を確認する

hanamaru は Node のネイティブ type stripping で `.ts` をそのまま実行する。そのため Node のバージョンに下限がある。

```console
$ node -v
v24.14.0
```

**22.18.0 以上**であること。22.18.0 は type stripping がフラグなしで使えるようになったバージョンであり、モジュール解決に介入するための `module.registerHooks`（22.15.0 で追加）も同時に満たす最小バージョンである。

Bun で動かす場合は 1.3 以上。

TypeScript は **5.4 以上**。hanamaru の型定義が `NoInfer` を使う。

## 推奨する tsconfig 設定

`tsconfig.json` に `erasableSyntaxOnly` を追加することを推奨する（TypeScript 5.8 以上）。

```json
{
  "compilerOptions": {
    "erasableSyntaxOnly": true
  }
}
```

Node の type stripping は型を空白に置き換えるだけで、コード生成を行わない。つまり `enum`、値を持つ `namespace`、parameter properties（`constructor(private x: number)`）、デコレータのような「ランタイムコードを生成する TypeScript 構文」は実行できず、`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` になる。`erasableSyntaxOnly: true` はこれらをコンパイル時にエラーにするため、実行して初めて気づく事故を防げる。使えない構文の一覧は [制約](./limitations.md) を参照。

なお、hanamaru のために tsconfig を変更する必要はこれ以外にない。import の書き方（`./dep.ts` / `./dep.js` / `./dep` / tsconfig の `paths` による `@/dep.js`）はどれもそのまま動くので、プロジェクトの通常のソースと同じ書き方でよい。

ただし、それを成り立たせている機構は Node と Bun で違う。

- **Node**: ネイティブ type stripping 単体では相対 import に `.ts` 拡張子が必須で、`paths` も無視される。hanamaru が `module.registerHooks` でモジュール解決に介入してこれを吸収する
- **Bun**: Bun 自身が `.js` 慣例・拡張子省略・`paths` をすべてネイティブに解決するため、hanamaru は介入しない

書き方が同じで機構だけが違う、ということである。

## テスト対象のコードを用意する

`src/user.ts` を作る。

```ts
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

`createUser` は `userRepository.save` と `mailService.send` という2つの依存を持つ。テストでは、この2つの挙動を宣言し、正しく呼ばれたかを検証する。

## 最初のテストを書く

`src/user.test.ts` を作り、1行ずつ組み立てていく。

vitest や jest に慣れていると、`describe` / `it` のコールバックの中に手続きを書く形が身についているはずだ。hanamaru はそこが違う。`new Test()` はテストを実行しない。チェーンで組み立てているのは**実行可能なデータ構造**であり、実行するのは CLI である。なぜこの形なのかは [考え方](./concepts.md) に書いた。

### 1. `.target()` でテスト対象を決める

```ts
import { Test } from 'hanamaru'
import { createUser } from './user.ts'

export const users = new Test()
  .target(createUser)
```

`.target()` はテスト対象を1つ決める。ここで渡した関数のシグネチャが、この先のチェーン全体に型として伝播する。後で書く `.args()` の引数の型も、`e.result` の型も、すべてここから決まる。

見出しは `.target()` から自動で導出される。この場合は `createUser`。オブジェクトのメソッドを対象にした場合（`.target(userService, 'create')`）は `UserService.create` になる。上書きしたいときは `.describe()` を使う。

`export` しているのが重要で、hanamaru は**各ファイルの export された値のうち `Test` インスタンスであるもの**を集めて実行する。export していない `Test` は実行されない。

### 2. `.mock()` で依存の挙動を宣言する

```ts
import { Test } from 'hanamaru'
import { createUser, userRepository, mailService } from './user.ts'

export const users = new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .mock(mailService, 'send', m => m.resolves(undefined))
```

`.mock(obj, 'method', m => behavior)` は、オブジェクトのメソッドを差し替える。第3引数のコールバックが返すのは「振る舞い」で、`m.returns(v)` / `m.resolves(v)` / `m.throws(e)` / `m.rejects(e)` / `m.callsFake(fn)` の5つがある。

型は元のメソッドに縛られる。`m.resolves()` に渡せるのは `Awaited<ReturnType>` なので、`m.resolves({ nope: 1 })` は型エラーになる。

ここで書いた `.mock()` は**全ケース共通**のモックになる。そして同時に、「このオブジェクトのこのキーは登録済みである」という情報が型に積み上がる。後の `.expect()` で `e.mock()` が使えるのは、ここで登録したものだけになる。

### 3. `.it()` でケースを足す

```ts
export const users = new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .mock(mailService, 'send', m => m.resolves(undefined))
  .it('保存して通知する', t => t
    .args({ name: 'Alice' })
  )
```

`.it(name, t => ...)` の中では、そのケース専用のビルダー `t` を組み立てる。`.args()` は target にそのまま渡す引数を書く。型は `Parameters<typeof createUser>` に縛られているので、`.args({ nam: 'Alice' })` のような typo も `.args(123)` のような型違いも、ここでコンパイルエラーになる。

`.setup()` で作ったフィクスチャから引数を組み立てたい場合は、`.args()` ではなく `.argsFrom(ctx => [...])` を使う。2つが分かれているのは、target の第1引数が関数型のときに「関数を引数として渡した」のか「コンテキストから引数を組み立てる関数」なのかを型で区別できないためで、メソッドを分けることで曖昧性が消える。`.argsFrom()` は可変長引数に対応するため引数をタプルで返す。この2つは排他で、どちらか一方を必ず呼ぶ。

ただしこの段階ではまだコンパイルが通らない。`.it()` のコールバックは `.expect()` が返す終端型を返さなければならないからだ。次で足す。

### 4. `.expect()` でアサーションを書く

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

`.expect()` のコールバックは**アサーションの記述オブジェクトの配列**を返す。`e.result.toEqual(...)` は呼ばれた時点では何も検証しない。ただ「result を toEqual で比較する」という記述を返すだけで、実際の評価はフレームワークが行う。だから配列で並べられる。

- `e.result` は target の戻り値。Promise なら await 済みなので、ここでは `User` として扱える
- `e.error` は target が投げた例外
- `e.mock(obj, 'method')` はモックの呼ばれ方。`.mock()` で登録していないものを渡すとコンパイルエラーになる

`.expect()` を呼んだ時点でそのケースは終端になり、それ以降メソッドは生えない。「`.expect()` の後に `.mock()`」のような順序違反は構造的に起きない。

2つ目のケースも足しておく。ケース内の `.mock()` は、そのケースだけ追加・上書きできる。

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

同じ `(obj, key)` に対する `Test` レベルと `it` レベルのモックは、後勝ちで `it` レベルが優先される。ケースが終われば `finally` で必ず元に戻るので、前のケースのモックが次に漏れることはない。

## 実行する

```console
$ npx hanamaru
```

引数なしで実行すると、設定ファイルの `include`（既定 `**/*.test.ts`）に一致するファイルを対象にする。ファイルを直接指定することもできる。

```console
$ npx hanamaru src/user.test.ts
```

全て成功すれば終了コードは 0 になる。

## わざと失敗させてみる

hanamaru の性質が一番よく分かるのは失敗したときなので、一度ずらしてみる。`userRepository.save` のモックの戻り値を `{ id: 'u2' }` に変える。

```ts
  .mock(userRepository, 'save', m => m.resolves({ id: 'u2' }))
```

`e.result.toEqual({ id: 'u1' })` と `e.mock(mailService, 'send').calledOnceWith({ id: 'u1' })` の両方が期待とずれることになる。実行するとこうなる。

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

注目するのは **2件とも報告されている**ことだ。hanamaru は1つ目のアサーションが落ちても後続を全部評価し、失敗をまとめて報告する。「結果も違うし、通知も期待した引数で飛んでいない」が一度の実行で分かる。1つ直して、また実行して、次の失敗を知る、という往復が要らない。

テストが1つ以上失敗したときの終了コードは 1 になる。

## package.json に script を足す

```json
{
  "scripts": {
    "test": "hanamaru"
  }
}
```

```console
$ npm test
```

型チェックは hanamaru では行わない。hanamaru はテストを実行するだけなので、型エラーは `tsc --noEmit` で別途検出する。両方走らせたい場合は script を分けて並べるとよい。

## 次に読むもの

- [考え方](./concepts.md) — なぜチェーンなのか。テストを値として扱う設計と内部アーキテクチャ
- [`Test` ビルダー](./api-test.md) — `.describe()` / `.setup()` / `.only()` / `.skip()` / `.todo()`
- [`.mock()`](./api-mock.md) — 5つの振る舞いと型の縛り
- [`.expect()`](./api-expect.md) — マッチャの全一覧
- [型推論](./type-inference.md) — 型で防げること、そして型の限界
- [実行セマンティクス](./semantics.md) — 実行手順、`only` の扱い、終了コード
- [CLI](./cli.md) — オプションと `hanamaru.config.ts`
- [制約](./limitations.md) — 使えない TypeScript 構文、初版のスコープ外
