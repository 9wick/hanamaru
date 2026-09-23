# モック

オブジェクトのメソッドを、そのケースで使う振る舞いに置き換えます。
振る舞いを変えたい依存に対して、オブジェクトとメソッド名を指定します。

```ts
.mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
```

モック用の別名は不要です。第3引数は完成した振る舞いを返します。
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

## 呼び出しごとに動作を変える

```ts
.mock(api, 'fetch', m => m
  .rejectsOnce(new Error('temporary failure'))
  .resolves({ id: 'u1' }))
```

1回目はreject、2回目以降はresolveします。returnsOnce / resolvesOnce / throwsOnce / rejectsOnce / callsFakeOnceを順に並べられます。
各値とfakeの型は通常動作と同じです。最後にreturns等の通常動作を指定して完成させます。
onceだけを返す定義は型エラーです。使い切った後に暗黙のundefinedを返しません。

順序は呼び出し開始順で、Promiseの完了順ではありません。各ケース・各試行で先頭へ戻します。
余ったonceだけでは失敗にしません。必要な回数はexpectCallsで検証します。
ケース側のmockでは列全体を上書きし、親の列へ部分的に追記しません。
blueprintにはkind: sequence、onceの非空配列、fallbackの通常動作を保持します。
該当メソッドの呼び出し条件が失敗した場合、標準CLIの詳細には設定したonceと継続動作の種類も添えます。
結果の条件参照とblueprintのmocksから、その設定を構造として対応させられます。

## 共通設定とケースの上書き

```ts
new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .it('保存に失敗したら通知しない', t => t
    .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
    .args({ name: 'Alice' })
    .expect(e => [
      e.error.toBeInstanceOf(Error),
    ])
    .expectCalls(call => [call(mailService, 'send').notCalled()]))
```

同じオブジェクト参照・同じキーへの登録は、外側の親→内側の親→子→ケースの順で上書きします。
同じスコープ内では最後に書いたものが有効です。兄弟のスコープへは漏れません。
別の振る舞いを足すときにも同じmockを使います。変更はそのケースだけに適用されます。

`.blueprint()` は各グループ・テストの共通モックをそのノードのmocksに、ケースのモックをCase.mocksに保持します。
同じスコープ内の再登録は最初の登録位置を保って1件にまとめます。
実行器はケースへ至る経路の設定を順に重ね、最初の登録位置を保って振る舞いを上書きします。
[グループごとの設定の例](./grouping.md)も参照してください。

## 検証

```ts
.expect(e => [
  e.result.toEqual({ id: 'u1' }),
])
.expectCalls(call => [
  call(userRepository, 'save').calledOnceWith({ name: 'Alice' }),
  call(mailService, 'send').calledOnceWith({ id: 'u1' }),
])
```

呼び出しを検証するためのmock登録は不要です。expectCallsは任意のメソッドを指定でき、引数は元のメソッドの型に従います。
モックを設定したメソッドならその振る舞いを使い、設定していなければ本物を呼びます。
同じオブジェクト・キーに対する差し替えと記録は1つにまとめ、二重には記録しません。
[マッチャ](./api-expect.md)を参照してください。

## 差し替えの範囲

対象はメソッドを持つオブジェクトです。モジュールモックや、既に別変数へ保存された関数参照の置換は含みません。
呼び出しがそのオブジェクトのプロパティを通る必要があります。

適用前のプロパティdescriptorを保存し、試行終了時に復元します。
差し替え不能なプロパティ、アクセサ、実行時に非関数だった値は失敗として扱います。
復元・記録範囲の契約は[実行セマンティクス](./semantics.md)を参照してください。
