# 型推論

通常は型パラメータを手書きする必要はありません。独立した子で親のctxを使う場合だけ、その要求型を宣言します。
型の契約は[hanamaru.d.ts](./spec/hanamaru.d.ts)、型エラーの検証は[type-errors.ts](./spec/type-errors.ts)にあります。

## 対象とコンテキスト

| 型 | 決まるところ | 使うところ |
|---|---|---|
| F: 対象の関数型 | target | args、argsFrom、result |
| C: その段階のコンテキスト型 | 親への要求型、setupの戻り値、useでnextへ渡す値 | 次のsetup / use、argsFrom、e.ctx |
| R: 親に要求するコンテキスト型 | new Test<R>()。省略時は{} | groupの供給チェック、runのルートチェック |

引数は `Parameters<F>`、結果の期待値は `Awaited<ReturnType<F>>` です。
setupの戻り値 `Awaited<S>` のフィールドをCへ追加し、同名のフィールドは置き換えます。
Promise自体をctxにはしません。各コールバックに渡るctxのフィールドはreadonlyです。

```ts
new Test()
  .target(add)
  .setup(async () => ({ a: 1, expected: 3 }))
  .it('型が伝わる', t => t
    .argsFrom(ctx => [ctx.a, 2])
    .expect(e => [e.result.toBe(e.ctx.expected)]))
```

## middlewareから型を伝える

```ts
new Test()
  .use(async (_, next) => {
    const db = await createDatabase()
    try {
      return await next({ db, expected: 3 })
    } finally {
      await db.close()
    }
  })
  .target(countUsers)
  .it('型が伝わる', t => t.argsFrom(ctx => [ctx.db])
    .expect(e => [e.result.toBe(e.ctx.expected)]))
```

nextは渡されたフィールド型Sを保持する `Promise<MiddlewareResult<S>>` を返します。
useはmiddlewareの戻り値からSを推論し、後続のCへ追加します。
ブランド付きの完了値なので、return忘れや通常のオブジェクトの返却は型エラーです。
`next()` はフィールドを追加せずCを保ちます。setupと同様に、同名フィールドは置き換えます。
親のuseで供給したフィールドも、groupで子が要求する型と照合します。

## 設定とケース追加を分ける

```text
Test<R> → target → TestBuilder<F, C, R> → it → Suite<F, C, R>
        → group → GroupSuite<C, R>
```

TestBuilderはsetup・use・mockとケース追加を持ち、Suiteはケース追加とplanだけを持ちます。
グループも最初のgroupで設定を固定し、GroupSuiteはgroupとplanだけを持ちます。
既存ケースを書いた後のtargetやctxの変更を型で防ぎ、対象を選んだ後のtargetの再指定も禁止します。
元のTestBuilderはイミュータブルなので、そこから別のsetup・use・mockを選ぶ派生は作れます。

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

## グループ内のctx

```ts
const child = new Test<{ a: number }>()
  .target(add)
  .it('親の値を使う', t => t.argsFrom(ctx => [ctx.a, 2])
    .expect(e => [e.result.toBe(3)]))

const parent = new Test()
  .setup(() => ({ a: 1, extra: true }))
  .group(child)

run(parent.plan())
```

childは親に `{ a: number }` を要求します。親に余分なフィールドがあっても合成できます。
不足や型違い、必須フィールドに対するoptionalな供給は型エラーです。
子が型パラメータを省略すれば、親ctxへの要求はありません。

Rは子の定義を作っている間ずっと親への要求として保持します。
子自身のsetup・useで同名のフィールドを供給しても、それより前のコードがRを利用し得るので要求は消しません。
間のグループも `new Test<R>()` で必要なctxを宣言し、さらに外側の親から受け取れます。

planは親への要求を型として保持します。runへ渡せるのは `{}` から実行できるルートだけです。
親ctxを要求する子はplanの取得まで可能ですが、単独実行や計画配列への混入を型で防ぎます。

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
- 未供給のctxプロパティ参照、setup・useの非同期処理から伝わる型
- ケース・group追加後の共通設定変更
- グループの親によるctxの供給、要求が残る計画の単独実行
- setup・useを重ねたときのctxの型、middlewareのreturn忘れ
- 引数の確定と期待の順序、未完了のケース、期待の二重定義
- result/errorの混在、空配列、マッチャの呼び忘れ、非同期predicate

## 型の限界

親ctxの要求型はJavaScriptでは消えるため、CLIはexportされた子が親ctxを要求するか検査できません。
型が防ぐのはgroup・runを呼ぶ際の不足です。CLIへ公開するルートには必要なctxを全て用意し、子は探索対象外のファイルに置きます。
型引数を宣言するだけで値が生成されることはありません。

同じ構造の別オブジェクトはTypeScriptの型だけでは区別できません。
呼び出しの記録は、実際に指定した参照に付けます。別オブジェクトの指定を、未登録のエラーとしては扱いません。
テストが意図した参照を選んでいるかどうかは、型だけでは検査できません。

anyや型アサーションで型検査を回避した値、プロパティの差し替え可否は実行時検査が必要です。
setupの戻り値やnextへの追加フィールドがplain objectかどうかは、実行時に検査します。
nextを1回呼んでその完了を待つこと、返した完了値がその呼び出しのものかは、型だけでは保証できません。
finallyがあるときに `return next(...)` で早く片付けてしまう誤りも型では防げないため、`return await next(...)` と書きます。
省略可能なメソッドは、存在を保証する型へ絞ってから渡します。
オーバーロードやジェネリック関数では、Parameters/ReturnTypeだけで全ての関係を保持できない場合があります。
必要ならテストしたい具体的なシグネチャの関数で包みます。

## 検証

```console
tsc -p docs/spec/tsconfig.json
```

このコマンドはサンプルの型チェックと、`@ts-expect-error` を付けた誤操作が型エラーになることを検証します。
グループ・ctxの検証は[group-types.ts](./spec/group-types.ts)、middlewareの検証は[middleware-types.ts](./spec/middleware-types.ts)にあります。
APIの実装を実行するものではありません。ランナー自体も型チェックはせず、通常のtest scriptからtscを呼ぶ想定です。
