# it ビルダー

ケースでは、必要ならモックを上書きし、引数を決め、期待を返します。
戻り値・例外と、呼び出しの条件を、それぞれ配列に並べます。

```ts
.it('保存に失敗したら通知しない', t => t
  .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
  .args({ name: 'Alice' })
  .expect(e => [
    e.error.toBeInstanceOf(Error),
  ])
  .expectCalls(call => [
    call(mailService, 'send').notCalled(),
  ])
)
```

## args / argsFrom

`.args(...args)` は対象の引数をそのまま受け取ります。
`.argsFrom(ctx => [...args])` はそのケースの親から子までのmiddlewareで用意したコンテキストから引数タプルを作ります。

```ts
.args(1, 2)
.argsFrom(ctx => [ctx.a, ctx.b])
```

上記は二者択一です。引数は一度だけ確定し、それまではexpectもexpectCallsも呼べません。
引数のない関数にも `.args()` を書きます。
argsFromは各試行で、middlewareの前処理の後・テスト対象の呼び出し前に1回評価します。

## timeout / retry

`.timeout(ms)` / `.retry(count)` でそのケースだけの実行設定を上書きします。
argsの前後で使え、expect / expectCallsの後には変更できません。
未指定の項目はgroupやケースに共通する設定から引き継ぎます。eachのtにも同じ操作があります。
[timeoutとretry](./execution-options.md)を参照してください。

## mock

`.mock(obj, key, def)` はTestレベルと同じAPIです。
同じ参照・同じキーなら共通設定を置き換え、新しい組ならそのケースだけに追加します。
argsの前でも後でも書けます。expect / expectCallsを始めた後は追加できません。
適用順序は記述位置にかかわらず[実行セマンティクス](./semantics.md)に従います。

## expect / expectCalls

```ts
.expect(e => [
  e.result.toEqual({ id: 'u1' }),
])
.expectCalls(call => [
  call(mailService, 'send').calledOnceWith({ id: 'u1' }),
])
```

expectは結果・例外、expectCallsは呼び出しを検証します。
どちらもコールバックから1つ以上のアサーションを配列で返します。
空配列、マッチャの呼び忘れ、配列のreturn忘れは型エラーです。

一方だけでもケースとして完成します。両方書く場合はどちらの順でもよく、それぞれ1回だけ設定できます。
複数の条件は、それぞれの配列に並べます。期待を書いた後にargs・mock・timeout・retryを変更することはできません。

| 期待の内容 | 期待する終了 |
|---|---|
| expectでresultを返す | 正常終了 |
| expectでerrorを返す | throw / reject |
| expectCallsだけを書く | 正常終了 |
| expectでresultとerrorを混在させる | 型エラー。実行時も不正な期待として失敗 |

判断に使うのは返された記述子です。返していないマッチャを呼んでも、期待や記録対象には追加しません。

## 呼び出し条件を先に構造化する

expectCallsのコールバックは定義時に1回評価します。
`call(obj, key)` はメソッドを呼ばず、マッチャがobject・key・条件を持つ記述子を作ります。
それをblueprintへ保持するため、実行器はテスト対象を呼ぶ前に記録対象を確定できます。
mockやspyの事前登録は不要で、別途importする補助関数もありません。

この段階ではmiddlewareは未実行です。callにコンテキストはなく、対象参照と期待する引数は定義時に渡せる値を使います。
実行時のコンテキストを使う引数や結果の期待には、argsFromとexpectを使います。

## 結果の期待を組み立てる時点

expectのコールバックは各試行でテスト対象の呼び出しが終わった後に1回評価します。
`e.ctx` はmiddlewareが渡した値を順に反映したコンテキストで、`e.result` と `e.error` は記述子を作るためのマッチャです。
対象が例外を投げた場合もresultの記述子は作れますが、実際の終了と合わなければ失敗します。
コールバック自体のthrowはテストの失敗であり、テスト対象に期待した例外として扱いません。

呼び出しの記述子は既にblueprintにあるため、expectの構築や結果の照合が失敗しても呼び出しの検証は続けます。
マッチャの一覧は[マッチャ](./api-expect.md)、型の仕組みは[型推論](./type-inference.md)を参照してください。
