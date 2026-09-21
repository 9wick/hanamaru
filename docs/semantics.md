# 実行セマンティクス

hanamaru でテストを書いたとき、実際に何がどの順で起きるのかを定めます。

`new Test()` はテストを実行しません。実行可能なデータ構造を組み立てて返すだけです。
そのデータ構造を実際に走らせるのが、ここで説明する実行セマンティクスです。

関連: [概念](./concepts.md) / [CLI](./cli.md) / [型推論](./type-inference.md)

## テストの発見

CLI は次の順でテストを集めます。

1. 対象ファイルを glob で集める（コマンドライン引数、なければ設定ファイルの `include`）
2. 各ファイルを `import()` する
3. export されている値のうち、`Test` インスタンスを集める

ここで重要なのは 3 番目です。**export されていない `Test` は実行されません。**

```ts
// src/user.test.ts
import { Test } from 'hanamaru'
import { createUser, userRepository, mailService } from './user.ts'

// export されているので実行される
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

// export されていないので実行されない
const draft = new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'u2' }))
  .it('書きかけ', t => t.args({ name: 'Bob' }).expect(e => [e.result.toEqual({ id: 'u2' })]))
```

この規則には意図があります。テスト定義を**値として再利用できるようにするため**です。

`Test` のすべてのメソッドはイミュータブルで、新しいビルダーを返します。
そのため、export したテスト定義を別ファイルから import して派生を作れます。

```ts
// src/user-with-db.test.ts
import { users } from './user.test.ts'

export const usersWithDb = users.setup(() => ({ db: makeTestDb() }))
```

「ファイルの中に書いたものが全部走る」ではなく「export したものが走る」という規則にすることで、
組み立て途中のビルダーや、他所で組み合わせるための部品を、同じファイルに置いておけます。

## 1ケースの実行手順

1つの `.it()` について、次の 6 ステップが順に実行されます。

1. **`.setup()` を実行してコンテキストを得る**
   `.setup()` を呼んでいない場合、コンテキストは `{}` です。
   第1引数の関数が返した値がそのままコンテキストになります。
   `.setup()` の第2引数に後始末の関数を渡していた場合、その関数はステップ 6 でコンテキストを受け取って呼ばれます。

2. **モックを適用する**
   `Test` レベルの `.mock()` を先に、`it` レベルの `.mock()` を後に適用します。
   同じ `(obj, key)` の組に対する宣言が両方にある場合は**後勝ち**、つまり `it` レベルが勝ちます。

3. **引数を決める**
   `.args()` ならその値をそのまま使います。`.argsFrom()` なら、ステップ 1 で得たコンテキストを渡して
   コールバックを呼び、返ってきたタプルを引数に使います。

4. **target を呼ぶ**
   戻り値が Promise なら await します。`.target(obj, 'method')` の形で指定した場合、`this` は正しく束縛されます。

5. **`.expect()` のアサーションを全部評価する**
   1つ落ちても後続を評価します。詳しくは[次の節](#アサーションは全部評価する)。

6. **`finally` で後始末する**
   モックを元のプロパティに戻し、`.setup()` の第2引数に後始末の関数を渡していればそれを呼びます。

### 後始末は必ず実行される

ステップ 6 は `finally` で実行されます。
ステップ 4 で target が例外を投げても、ステップ 5 でアサーションが失敗しても、必ず実行されます。

このため、**前のケースのモックが次のケースに漏れることはありません。**
あるケースで `userRepository.save` を差し替えても、そのケースが終わった時点で元のメソッドに戻っています。

### setup はケースごとに1回

`.setup()` は**各テストケースごとに1回**実行されます。ケース間で値は共有されません。

```ts
export const users = new Test()
  .target(createUser)
  .setup(() => ({ db: makeTestDb() }), ctx => ctx.db.close())
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .it('ケース A', t => t.args({ name: 'Alice' }).expect(e => [e.result.toEqual({ id: 'u1' })]))
  .it('ケース B', t => t.args({ name: 'Bob' }).expect(e => [e.result.toEqual({ id: 'u1' })]))
```

この例では `makeTestDb()` が 2 回呼ばれます。ケース A が `db` に書き込んだ内容は、ケース B には見えません。
第2引数に渡した後始末の関数も同様にケースごとに呼ばれ、そのケースの `db` を受け取って閉じます。

### モックの適用順

`Test` レベル → `it` レベルの順に適用し、同じ `(obj, key)` は後勝ちです。

```ts
export const users = new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .mock(mailService, 'send', m => m.resolves(undefined))
  .it('保存に失敗したら通知しない', t => t
    // Test レベルの userRepository.save を上書きする
    .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
    .args({ name: 'Alice' })
    .expect(e => [
      e.error.toBeInstanceOf(Error),
      e.mock(mailService, 'send').notCalled(),
    ])
  )
```

このケースでは、`userRepository.save` は `it` レベルの `rejects` が使われ、
`mailService.send` は `Test` レベルの `resolves(undefined)` がそのまま使われます。

## アサーションは全部評価する

`.expect()` が返したアサーションは、**1つ落ちても後続を評価します**。失敗はまとめて報告されます。

マッチャは呼ばれた時点では何も検証せず、記述を返すだけです。実際の評価はフレームワークが行います。
だからこそ、配列に並んだすべての記述を独立に評価できます。

```ts
.expect(e => [
  e.result.toEqual({ id: 'u1' }),
  e.mock(mailService, 'send').calledOnceWith({ id: 'u1' }),
])
```

最初の `e.result.toEqual` が失敗しても、次の `e.mock(...).calledOnceWith` は評価されます。

理由は、**「結果も違うし通知も飛んでいない」が一度の実行で分かる**ようにするためです。
最初の失敗で打ち切る方式だと、1つ直して再実行して次の失敗を見つける、という往復が必要になります。

失敗したときの出力はこうなります。

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

## result と error の関係

`e.result` は target の戻り値（Promise なら await 済み）、`e.error` は target が投げた例外を指します。
target が正常終了したか例外を投げたかによって、どちらかは存在しません。

- **`e.result` を使ったのに target が例外を投げた** → 失敗。
  「予期しない例外」として、元の例外とスタックトレースを添えて報告します。
- **`e.error` を使ったのに target が正常終了した** → 失敗。
  「例外が発生しませんでした」と報告します。

```ts
// target が例外を投げる場合
.it('保存に失敗したら通知しない', t => t
  .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
  .args({ name: 'Alice' })
  .expect(e => [
    e.error.toBeInstanceOf(Error),          // 例外を期待しているので正しい
    e.mock(mailService, 'send').notCalled(),
  ])
)
```

同じ `.expect()` の中で `e.result` と `e.error` を両方使うことは可能ですが、
target は正常終了と例外送出のどちらか一方しか起きないため、**必ずどちらかが失敗します**。

```ts
.expect(e => [
  e.result.toEqual({ id: 'u1' }),   // 正常終了したならこちらが評価される
  e.error.toBeInstanceOf(Error),    // 正常終了したならこちらが失敗する
])
```

`e.result` と `e.error` を並べて書いても、どちらか一方が通る、という書き方にはなりません。

## only / skip / todo

### only

どこか1箇所でも `.only()` があれば、**全ファイル横断で** only のついたケースだけを実行します。
他のケースは skip として報告されます。

```ts
export const users = new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .mock(mailService, 'send', m => m.resolves(undefined))
  .only('保存して通知する', t => t
    .args({ name: 'Alice' })
    .expect(e => [e.result.toEqual({ id: 'u1' })])
  )
  .it('保存に失敗したら通知しない', t => t
    .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
    .args({ name: 'Alice' })
    .expect(e => [e.error.toBeInstanceOf(Error)])
  )
```

この状態で実行すると、「保存して通知する」だけが実行されます。
「保存に失敗したら通知しない」は skip として報告されます。
同じことが**他のファイルのケースにも及びます**。別ファイルの `.it()` もすべて skip になります。

### skip と todo

```ts
  .skip('あとで直す', t => t
    .args({ name: 'Alice' })
    .expect(e => [e.result.toEqual({ id: 'u1' })])
  )
  .todo('メールの本文を検証する')
```

- `.skip(name, t => ...)` は `.it()` と同じくコールバックを取ります。中身は書いてあるが実行しない、という状態です。
- `.todo(name)` は**コールバックを取りません**。名前だけを登録します。まだ中身を書いていない、という状態です。

## 終了コード

| コード | 意味 |
|---|---|
| 0 | 全て成功（skip / todo のみでも 0） |
| 1 | テストが1つ以上失敗 |
| 2 | 設定エラー・ファイル読み込みエラー |

skip や todo は失敗として扱いません。すべてのケースが skip でも終了コードは 0 です。

テストファイルの import に失敗した場合や、設定ファイルが読めない場合は 2 になります。
これはテストの失敗（1）とは区別されます。CI では両者を分けて扱えます。

CI での使い方は [CLI](./cli.md) を参照してください。
