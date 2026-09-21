# 型推論

型パラメータはチェーンから推論します。利用者が手書きする必要はありません。
型の契約は[hanamaru.d.ts](./spec/hanamaru.d.ts)、型エラーの検証は[type-errors.ts](./spec/type-errors.ts)にあります。

## 積み上がる3つの型

| 型 | 決まるところ | 使うところ |
|---|---|---|
| F: 対象の関数型 | target | args、argsFrom、result |
| M: モック登録のタプル | mock | e.mockの参照可能なキー |
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
Test → target → TestBuilder<F, M, C> → it → Suite<F, M, C>
```

TestBuilderはsetup・mockとケース追加を持ち、Suiteはケース追加とplanだけを持ちます。
これにより、既存ケースを書いた後のtargetやctxの変更を型で防ぎます。
対象を選んだ後のtargetの再指定もできません。
元のTestBuilderはイミュータブルなので、そこから別のsetupやmockを選ぶ派生は作れます。

ケース内部も `ItBuilder → args / argsFrom → ItArgs → expect → ItDone` と分かれます。
argsの二度書き、argsなしのexpect、expect後の操作、itコールバックのreturn忘れを防ぎます。

## オブジェクトとキーによるモックの推論

```ts
export type MockEntry = { readonly obj: object; readonly key: string }
export type RegKey<M extends readonly MockEntry[], O> =
  Extract<M[number], { obj: O }>['key']
```

`.mock(obj, key, def)` のたびに `M` に `{ obj: O; key: K }` を追加します。
`e.mock(obj, key)` はMから登録済みのキーを求め、さらに関数型のプロパティであることを要求します。
`NoInfer<O>` は、この照合側からオブジェクトの推論が広がることを防ぎます。

モックの振る舞いは元メソッドのReturnType、呼び出し検証はParametersに従います。
ケース内の登録はそのケースのMだけに追加し、次のケースには渡しません。
同じ組を複数回登録しても、実行時の実効モックは最後の振る舞い1つに解決します。

## 同じexpectで、矛盾した期待を防ぐ

マッチャが返す記述子はresult / error / mockのsubjectとブランドを持ちます。
expectの戻り値は次のunionです。

```ts
export type Assertions =
  | readonly [ResultAssertion | MockAssertion, ...(ResultAssertion | MockAssertion)[]]
  | readonly [ErrorAssertion | MockAssertion, ...(ErrorAssertion | MockAssertion)[]]
```

配列にresultとerrorの両方を入れると、どちらの型にも一致しません。
通常の `.expect(e => [...])` のままで検査でき、型注釈や `as const` は不要です。
先頭要素を必須にして空配列を防ぎ、ブランドで素のbooleanやマッチャの呼び忘れも防ぎます。

モックだけの配列は正常終了を期待する契約です。型はそのデータを受け入れ、実行器が終了を照合します。
TypeScriptの型だけで対象のthrowを推論することはしません。

## 型で検査すること

- 対象と引数・期待値の型の一致
- メソッドキー、モックの戻り値・呼び出し引数の型
- 登録の型に存在しないモックへの参照、ケース間の登録漏出
- setupなしのctxプロパティ参照、非同期setupのawait後の型
- ケース追加後の共通設定変更
- 引数の確定とexpectの順序、未完了のケース
- result/errorの混在、空の期待、非同期predicate

## 型の限界

TypeScriptの構造的型付けでは、同じ形の別オブジェクトを区別できません。
実際のモック登録は参照とキーで照合するため、型が通っても未登録の別参照は実行時に失敗します。
これを避けるための別名やブランド付けを、利用者に要求しません。
unionや広い型のキーを使う場合も、実際にどのメソッドを登録したかは実行時の値で確かめます。

anyや型アサーションで型検査を回避した値、プロパティの差し替え可否も実行時検査が必要です。
省略可能なメソッドは、存在を保証する型へ絞ってから渡します。
オーバーロードやジェネリック関数では、Parameters/ReturnTypeだけで全ての引数と戻り値の関係を保持できない場合があります。
必要ならテストしたい具体的なシグネチャの関数で包みます。

## 検証

```console
tsc -p docs/spec/tsconfig.json
```

このコマンドはドキュメント用サンプルの型チェックと、`@ts-expect-error` を付けた誤操作が型エラーになることを検証します。
APIの実装を実行するものではありません。ランナー自体も型チェックはせず、通常のtest scriptからtscを呼ぶ想定です。
