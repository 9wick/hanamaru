# モック

オブジェクトのメソッドを、そのケースで使う振る舞いに置き換えます。
登録と参照には同じオブジェクトとメソッド名を使います。

```ts
.mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
```

モック用の別名は不要です。第3引数は振る舞いを1つ返します。
このコールバックは定義時に評価し、プロパティの差し替えは実行時に行います。

## 振る舞い

| 記法 | 振る舞い | 値の型 |
|---|---|---|
| `m.returns(value)` | valueをそのまま返す | メソッドのReturnType |
| `m.resolves(value)` | valueでresolveするPromiseを返す | 非同期メソッドのawait後の型 |
| `m.throws(error)` | 同期的にthrowする | unknown |
| `m.rejects(error)` | rejectするPromiseを返す | 非同期メソッドのみ、理由はunknown |
| `m.callsFake(fn)` | fnを代わりに呼ぶ | 元のメソッドの関数型 |

```ts
.mock(userRepository, 'save', m => m.callsFake(async input => ({ id: input.name })))
```

fakeの `this` は呼び出し時のreceiverを引き継ぎます。
resolves/rejectsは同期関数には使えません。returnsに渡したPromiseはそのまま共有されるので、
非同期の結果を返すモックには通常resolvesを使います。

## 共通設定とケースの上書き

```ts
new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .mock(mailService, 'send', m => m.resolves(undefined))
  .it('保存に失敗したら通知しない', t => t
    .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
    .args({ name: 'Alice' })
    .expect(e => [
      e.error.toBeInstanceOf(Error),
      e.mock(mailService, 'send').notCalled(),
    ]))
```

同じオブジェクト参照・同じキーへの登録は、共通設定を含めて最後に書いたものが有効です。
別の振る舞いを足すときにも同じmockを使います。変更はそのケースだけに適用されます。

`.plan()` の各ケースには、上書き解決後のモック一覧が入ります。
同じ組は1件で、最初に登録された位置を保ち、振る舞いだけを最後のものへ置き換えます。

## 検証

```ts
.expect(e => [
  e.result.toEqual({ id: 'u1' }),
  e.mock(userRepository, 'save').calledOnceWith({ name: 'Alice' }),
  e.mock(mailService, 'send').calledOnceWith({ id: 'u1' }),
])
```

参照できるキーは、そのケースの共通登録と追加登録から型で絞り込みます。
呼び出し引数も元のメソッドの型に従います。[マッチャ](./api-expect.md)を参照してください。

TypeScriptは同じ構造の別オブジェクトを型で区別できません。
実行時はオブジェクト参照とキーの一致を検査し、未登録なら失敗します。[型の限界](./type-inference.md)を参照してください。

## 差し替えの範囲

対象はメソッドを持つオブジェクトです。モジュールモックや、既に別変数へ保存された関数参照の置換は含みません。
呼び出しがそのオブジェクトのプロパティを通る必要があります。

適用前のプロパティdescriptorを保存し、ケース終了時に復元します。
差し替え不能なプロパティ、アクセサ、実行時に非関数だった値は失敗として扱います。
復元・記録範囲の契約は[実行セマンティクス](./semantics.md)を参照してください。
