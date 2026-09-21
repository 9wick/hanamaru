# 型推論

利用者が型パラメータを手書きする必要はありません。
型の契約は[hanamaru.d.ts](./spec/hanamaru.d.ts)、型エラーの検証は[type-errors.ts](./spec/type-errors.ts)にあります。

## 対象とコンテキスト

| 型 | 決まるところ | 使うところ |
|---|---|---|
| F: 対象の関数型 | target | args、argsFrom、result |
| C: コンテキスト型 | setup | argsFrom、e.ctx、dispose |

引数は `Parameters<F>`、結果の期待値は `Awaited<ReturnType<F>>` です。
非同期setupでは `Awaited<S>` がCになり、Promise自体をctxにはしません。

```ts
new Test()
  .target(add)
  .setup(async () => ({ a: 1, expected: 3 }))
  .it('型が伝わる', t => t
    .argsFrom(ctx => [ctx.a, 2])
    .expect(e => [e.result.toBe(e.ctx.expected)]))
```

## 設定とケース追加を分ける

```text
Test → target → TestBuilder<F, C> → it → Suite<F, C>
```

TestBuilderはsetup・mockとケース追加を持ち、Suiteはケース追加とplanだけを持ちます。
既存ケースを書いた後のtargetやctxの変更を型で防ぎ、対象を選んだ後のtargetの再指定も禁止します。
元のTestBuilderはイミュータブルなので、そこから別のsetupやmockを選ぶ派生は作れます。

ケースはargs / argsFromで引数を確定した後、expectとexpectCallsをそれぞれ一度だけ設定できます。
一方でも完成したケースですが、もう一方を追加できます。両方を設定したら終端です。
期待を書いた後にargsやmockへ戻ることはできません。

| 現在の型 | 次に設定できる期待 | itから返せるか |
|---|---|---|
| ItBuilder | なし。先にargs / argsFromが必要 | 不可 |
| ItArgs | expect、expectCalls | 不可 |
| ItExpected | expectCalls | 可 |
| ItCalls | expect | 可 |
| ItDone | なし | 可 |

これにより、return忘れ、検証を書いていないケース、期待の二重定義を防ぎます。

## モックの型と呼び出しの型

mockの振る舞いは、その場で渡されたメソッドのReturnTypeに従います。
callの条件も、その場で渡されたメソッドから推論します。

```ts
export interface CallBuilder {
  <O extends object, K extends FnKeys<O>>(
    obj: O, key: K
  ): CallMatchers<MethodOf<O, K>>
}
```

callはexpectCallsコールバックの引数であり、グローバルにexportする関数ではありません。
キーは存在する関数型プロパティに限り、calledWith / calledOnceWithの引数はそのメソッドのParametersです。

```ts
.expectCalls(call => [
  call(mailService, 'send').calledOnceWith({ id: 'u1' }),
])
```

この検証にはmock登録が不要です。登録済みのモック一覧を型パラメータへ積む必要もありません。
モックの有無は実行時の振る舞いを決めますが、呼び出しを検証できるかどうかの条件にはなりません。

## 結果と呼び出しを混同しない

expectが返せるのは、resultだけ、またはerrorだけの空でない配列です。

```ts
export type Assertions =
  | readonly [ResultAssertion, ...ResultAssertion[]]
  | readonly [ErrorAssertion, ...ErrorAssertion[]]
```

resultとerrorの混在は、どちらの型にも一致しません。
expectCallsが返せるのは、CallAssertionの空でない配列です。
通常のコールバックから配列を返す書き方で検査でき、`as const` は不要です。
各記述子のブランドによって、素のbooleanやマッチャの呼び忘れを防ぎます。

expectCallsだけのケースが正常終了を期待することは、実行器が照合する契約です。
TypeScriptの型だけで対象のthrowを推論することはしません。

## 型で検査すること

- 対象と引数・期待値の型の一致
- モックの戻り値と、呼び出し条件のメソッドキー・引数の型
- setupなしのctxプロパティ参照、非同期setupのawait後の型
- ケース追加後の共通設定変更
- 引数の確定と期待の順序、未完了のケース、期待の二重定義
- result/errorの混在、空配列、マッチャの呼び忘れ、非同期predicate

## 型の限界

同じ構造の別オブジェクトはTypeScriptの型だけでは区別できません。
呼び出しの記録は、実際に指定した参照に付けます。別オブジェクトの指定を、未登録のエラーとしては扱いません。
テストが意図した参照を選んでいるかどうかは、型だけでは検査できません。

anyや型アサーションで型検査を回避した値、プロパティの差し替え可否は実行時検査が必要です。
省略可能なメソッドは、存在を保証する型へ絞ってから渡します。
オーバーロードやジェネリック関数では、Parameters/ReturnTypeだけで全ての関係を保持できない場合があります。
必要ならテストしたい具体的なシグネチャの関数で包みます。

## 検証

```console
tsc -p docs/spec/tsconfig.json
```

このコマンドはサンプルの型チェックと、`@ts-expect-error` を付けた誤操作が型エラーになることを検証します。
APIの実装を実行するものではありません。ランナー自体も型チェックはせず、通常のtest scriptからtscを呼ぶ想定です。
