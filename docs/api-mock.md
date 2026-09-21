# モック

モックは「登録先」「振る舞い」「呼び出しの期待」の3つからなる。
その構造を実行計画に保持し、実行時だけ対象メソッドを差し替える。

## 名前で登録・参照する

```ts
.mock('save', userRepository, 'save', m => m.resolves({ id: 'u1', name: 'Alice' }))
.mock('send', mailService, 'send', m => m.resolves(undefined))
```

第1引数は登録名、第2引数はオブジェクト、第3引数は存在が保証された関数型の文字列キー。
第4引数は振る舞いの記述を返すコールバック。

```ts
.expect(e => [
  e.mock('save').calledOnceWith({ name: 'Alice' }),
  e.mock('send').calledOnceWith({ id: 'u1', name: 'Alice' }),
])
```

登録した名前だけが参照できる。同じ構造の別オブジェクトを検証時に渡すAPIはない。
元のメソッド型が登録名に対応し、戻り値・呼び出し引数の型を制約する。

名前は空でない文字列リテラル。同じ名前を再登録することは型エラー。
異なる名前で同じ `(object, key)` を登録した場合も、実際の差し替え先が重なるため定義エラーにする。
文脈由来の登録先が重なる場合は、実行時のbinding段階で検出する。

## 文脈から登録先を得る

```ts
.mockFrom('save', ctx => ctx.repository, 'save', m => m.resolves({ id: 'u1', name: 'Alice' }))
```

selectorはそのケースのsetup後に1回実行する。
計画にはselectorとキーを保持する。計画作成のためにselectorを先行実行しない。
型契約の `NoInfer` は、selectorの戻り値から先にオブジェクト型を確定させるために使う。

## 振る舞い

| API | 呼び出されたときの動作 | 型 |
|---|---|---|
| `returns(value)` | 値をそのまま返す | `ReturnType<F>` |
| `resolves(value)` | 値をresolveするPromiseを返す | 非同期メソッドの `Awaited<ReturnType<F>>` |
| `throws(error)` | 同期的にthrowする | `unknown` |
| `rejects(error)` | rejectするPromiseを返す | 非同期メソッドだけ |
| `callsFake(label, fn)` | 渡した関数を呼ぶ | 元のメソッドと同じシグネチャ |

同期メソッドに `resolves` / `rejects` は指定できない。
Promiseを返すメソッドに `returns(Promise.resolve(...))` を指定することは型として可能だが、
通常は呼び出しごとにPromiseを作る `resolves` / `rejects` を使う。
`throws` は戻り値型にかかわらず使える。Promiseを返すという型でも、同期throwする関数は表現できる。

```ts
.mock('find', repository, 'find', m => m.callsFake('u1だけ存在する', async id =>
  id === 'u1' ? { id: 'u1', name: 'Alice' } : null))
```

`callsFake` でも呼び出しは記録される。関数には呼び出し時の `this` と引数を渡す。

## 文脈から振る舞いを作る

```ts
.mock('save', repository, 'save', m =>
  m.resolvesFrom('fixtureのユーザー', ctx => ctx.user))
```

`returnsFrom(label, get)` / `resolvesFrom(label, get)` は、setup後、モック適用前に1回値を作る。
そのケースで複数回呼ばれたときは同じ値を返す。
`callsFakeFrom(label, ctx => fn)` はその段階でfake関数を作り、呼び出しごとにその関数を実行する。

静的な `returns` / `resolves` にオブジェクトを渡すと、ケース間でも同じ参照を使う。
対象がそれを書き換える可能性があるなら、setupまたは `*From` でケースごとに作る。
メソッドの復元と、渡したオブジェクトの状態の復元は別である。

## ケースで上書きする

```ts
.it('保存失敗', t => t
  .override('save', m => m.rejects(new Error('save failed')))
  .args({ name: 'Alice' })
  .expectError(e => [
    e.error.toThrow('save failed'),
    e.mock('send').notCalled(),
  ]))
```

`override` は既存の登録先・メソッド型を維持し、振る舞いだけを変える。
未登録名へのoverrideや、元のメソッドと合わない戻り値は型エラーになる。
計画の各ケースには、共通登録と上書きを解決したモック一覧が入る。

## 呼ばれ方を検証する

| マッチャ | 意味 |
|---|---|
| `calledTimes(n)` | 全呼び出し回数がn回 |
| `notCalled()` | 全呼び出し回数が0回 |
| `calledWith(...args)` | 指定した引数と深く等しい呼び出しが1回以上ある |
| `calledOnceWith(...args)` | 全呼び出し回数が1回で、その引数が深く等しい |
| `calledWithFrom(label, get)` | ctxから引数タプルを得て `calledWith` |
| `calledOnceWithFrom(label, get)` | ctxから引数タプルを得て `calledOnceWith` |

`calledTimes` のnは0以上の整数。負数・小数は定義エラーになる。
引数タプルは登録メソッドの `Parameters<F>` に制約される。
期待引数の `*From` はtarget終了後、アサーション評価時に呼ぶ。

`calledOnceWith` は一致した呼び出しだけを数えない。
別の引数で追加の呼び出しがあれば失敗し、失敗表示には全回数と実際の引数を出す。

## 差し替えの範囲

差し替えるのはオブジェクトのプロパティだけ。モジュールモックは提供しない。
対象は依存を `repository.save(...)` のように、実行時にプロパティ経由で呼ぶ必要がある。
差し替え前に取り出した関数参照や、直接importされた関数の呼び出しは置き換わらない。

書き換え不能なプロパティ、アクセサ、非関数の実体は実行時にエラーにする。
適用したプロパティはfinallyで元のdescriptorへ戻す。
継承されたメソッドなら、作成したown propertyを削除して継承状態に戻す。
詳細は[実行セマンティクス](./semantics.md)に定める。
